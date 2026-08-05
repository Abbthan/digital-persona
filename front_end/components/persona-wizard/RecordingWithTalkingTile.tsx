"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { uploadPersonaAsset } from "@/front_end/state/persona-client";
import { PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";
import { PERSONA_UPLOAD_LIMITS } from "@/shared/persona-upload-limits";
import { RecordingConsent } from "./RecordingConsent";
import { preferredAudioRecording, preferredVideoWithAudioRecording } from "./recording-media";
import { UploadTileShell } from "./UploadTileShell";

type RecordingWithTalkingTileProps = {
  personaId: string;
  personaName: string;
  locked?: boolean;
  onLockedClick?: () => void;
  onUploaded?: () => void;
  deferTraining?: boolean;
};

function captureSnapshot(video: HTMLVideoElement): Promise<Blob | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

// Stops a recorder and resolves once its final blob is assembled. Assigning
// onstop here (rather than once up front in startScan) is what lets
// finishScan simply await both recorders side by side instead of
// coordinating two independent callback-driven state machines.
function stopAndCollect(recorder: MediaRecorder, chunks: Blob[]): Promise<{ blob: Blob; mimeType: string }> {
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || "application/octet-stream";
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };
    if (recorder.state === "recording") recorder.stop();
    else resolve({ blob: new Blob(chunks, { type: recorder.mimeType || "application/octet-stream" }), mimeType: recorder.mimeType });
  });
}

export function RecordingWithTalkingTile({
  personaId,
  personaName,
  locked,
  onLockedClick,
  onUploaded,
  deferTraining = false,
}: RecordingWithTalkingTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Separate recorder on just the mic track, running in parallel with the
  // combined video+audio one — one take produces both a standalone voice
  // file for CosyVoice and a video file with its own embedded audio for
  // MuseTalk/LivePortrait, rather than making voice training depend on
  // extracting audio back out of the video container server-side.
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const finishingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds);
  const [error, setError] = useState<string | null>(null);

  function clearTimers() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function cancelScan() {
    finishingRef.current = false;
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (audioRecorderRef.current?.state === "recording") audioRecorderRef.current.stop();
    recorderRef.current = null;
    audioRecorderRef.current = null;
    stopCamera();
    setSecondsRemaining(PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds);
    setOpen(false);
  }

  useEffect(() => {
    if (scanning && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [scanning]);

  useEffect(() => () => {
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (audioRecorderRef.current?.state === "recording") audioRecorderRef.current.stop();
    stopCamera();
  }, []);

  async function finishScan() {
    const recorder = recorderRef.current;
    const audioRecorder = audioRecorderRef.current;
    const video = videoRef.current;
    if (finishingRef.current || !recorder || recorder.state !== "recording") return;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError("Camera is still starting. Please try again in a moment.");
      return;
    }
    finishingRef.current = true;
    clearTimers();
    const snapshotPromise = captureSnapshot(video);
    setScanning(false);
    setSecondsRemaining(0);

    const [snapshot, motion, audioOnly] = await Promise.all([
      snapshotPromise,
      stopAndCollect(recorder, chunksRef.current),
      audioRecorder
        ? stopAndCollect(audioRecorder, audioChunksRef.current)
        : Promise.resolve<{ blob: Blob; mimeType: string } | null>(null),
    ]);
    recorderRef.current = null;
    audioRecorderRef.current = null;
    stopCamera();

    if (!snapshot || motion.blob.size === 0) {
      finishingRef.current = false;
      setError("Couldn't save the facial motion scan. Please try again.");
      return;
    }
    // preferredVideoWithAudioRecording() only offers codec strings that
    // name an audio codec, but this stays as a last-resort check: if the
    // browser still negotiated something audio-less, refuse to upload a
    // silent "talking" recording rather than letting it through and only
    // surfacing the gap downstream in voice training.
    if (!/mp4a|opus/i.test(motion.mimeType)) {
      finishingRef.current = false;
      setError("Couldn't capture audio with this recording. Please check your microphone and try again.");
      return;
    }
    if (!audioOnly || audioOnly.blob.size === 0) {
      finishingRef.current = false;
      setError("Couldn't capture a separate voice recording. Please check your microphone and try again.");
      return;
    }

    setSaving(true);
    const stamp = Date.now();
    // The image provides a stable face reference; the video (with its own
    // embedded audio) is what the avatar trainer uses for talking motion;
    // the standalone audio file is the primary voice-training source (see
    // selectVoiceRefAsset in persona-training.ts) rather than relying on
    // CosyVoice's side to re-extract audio from the video container.
    const scan = new File([snapshot], `facial-scan-${stamp}.jpg`, { type: "image/jpeg" });
    const scanResult = await uploadPersonaAsset(
      personaId,
      scan,
      "facial_scan",
      PERSONA_ASSET_SOURCES.guidedFacialScan,
      true,
      true,
    );
    if (!scanResult.ok) {
      setSaving(false);
      finishingRef.current = false;
      setError(scanResult.error);
      return;
    }

    const motionExtension = motion.mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const motionFile = new File([motion.blob], `facial-motion-${stamp}.${motionExtension}`, { type: motion.mimeType });
    const motionResult = await uploadPersonaAsset(
      personaId,
      motionFile,
      "video",
      PERSONA_ASSET_SOURCES.guidedFacialScan,
      true,
      deferTraining,
    );
    if (!motionResult.ok) {
      setSaving(false);
      finishingRef.current = false;
      setError(motionResult.error);
      return;
    }

    // Browsers cannot natively encode straight to MP3 via MediaRecorder;
    // this uses the same m4a/webm convention the old standalone audio
    // recorder used, which is what actually gets normalized to WAV for
    // CosyVoice server-side regardless of source container.
    const audioExtension = audioOnly.mimeType.startsWith("audio/mp4") ? "m4a" : "webm";
    const audioFile = new File([audioOnly.blob], `facial-motion-audio-${stamp}.${audioExtension}`, { type: audioOnly.mimeType });
    const audioResult = await uploadPersonaAsset(
      personaId,
      audioFile,
      "audio",
      PERSONA_ASSET_SOURCES.guidedFacialScan,
      true,
      deferTraining,
    );
    setSaving(false);
    finishingRef.current = false;
    if (audioResult.ok) {
      onUploaded?.();
      setOpen(false);
      setSecondsRemaining(PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds);
    } else {
      setError(audioResult.error);
    }
  }

  async function startScan() {
    setError(null);
    try {
      // Camera and microphone captured together in one stream — this
      // recording drives both appearance training (MuseTalk/LivePortrait)
      // and voice training (CosyVoice) from a single take.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, aspectRatio: { ideal: 4 / 3 } },
        audio: true,
      });
      const format = preferredVideoWithAudioRecording();
      const recorder = format.mimeType ? new MediaRecorder(stream, { mimeType: format.mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      chunksRef.current = [];
      finishingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      // A second recorder on just the mic track, running alongside the
      // combined one — see the audioRecorderRef declaration for why.
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      const audioFormat = preferredAudioRecording();
      const audioRecorder = audioFormat.mimeType
        ? new MediaRecorder(audioOnlyStream, { mimeType: audioFormat.mimeType })
        : new MediaRecorder(audioOnlyStream);
      audioChunksRef.current = [];
      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.start(250);
      audioRecorder.start(250);
      recorderRef.current = recorder;
      audioRecorderRef.current = audioRecorder;
      const startedAt = Date.now();
      setSecondsRemaining(PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds);
      intervalRef.current = window.setInterval(() => {
        setSecondsRemaining(Math.max(0, PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds - Math.floor((Date.now() - startedAt) / 1_000)));
      }, 250);
      timerRef.current = window.setTimeout(finishScan, PERSONA_UPLOAD_LIMITS.facialScan.maxSeconds * 1_000);
      setScanning(true);
    } catch {
      stopCamera();
      setError("Camera or microphone access was denied.");
    }
  }

  return (
    <>
      <UploadTileShell
        label="Recording with talking"
        description="One 40-second recording of you talking — captures video and voice together; re-recording replaces it"
        locked={locked}
        onLockedClick={onLockedClick}
      >
        <Button variant="secondary" className="w-full" onClick={() => { setError(null); setOpen(true); }}>
          Start recording
        </Button>
        {error && <p role="alert" className="font-text text-caption text-red-500">{error}</p>}
      </UploadTileShell>

      <Modal open={open} onClose={cancelScan} maxWidthClassName="max-w-[38rem]" className="max-h-[calc(100dvh-3rem)] overflow-y-auto">
        <h2 className="font-display text-tagline text-ink">{`Recording with talking for ${personaName}`}</h2>
        <p className="mt-xs font-text text-caption text-ink-muted-80">
          {scanning ? `Recording — ${secondsRemaining}s remaining` : "Start when you are ready. It saves a face reference and a video-and-voice recording when you stop or when time runs out."}
        </p>
        <div className="mt-lg border-y border-hairline py-lg">
          <RecordingConsent personaName={personaName} />
        </div>
        {scanning && <video ref={videoRef} autoPlay muted playsInline className="mt-lg aspect-[4/3] w-full rounded-md bg-surface-black object-cover" />}
        <Button variant="secondary" className="mt-lg w-full" onClick={scanning ? finishScan : startScan} disabled={saving}>
          {saving ? "Saving…" : scanning ? `Stop & save (${secondsRemaining}s)` : "Start recording"}
        </Button>
        {error && <p role="alert" className="mt-sm font-text text-caption text-red-500">{error}</p>}
      </Modal>
    </>
  );
}
