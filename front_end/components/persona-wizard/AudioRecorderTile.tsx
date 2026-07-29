"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { uploadPersonaAsset } from "@/front_end/state/persona-client";
import { PERSONA_UPLOAD_LIMITS } from "@/shared/persona-upload-limits";
import { RecordingConsent } from "./RecordingConsent";
import { UploadTileShell } from "./UploadTileShell";

type AudioRecorderTileProps = {
  personaId: string;
  personaName: string;
  locked?: boolean;
  onLockedClick?: () => void;
  onUploaded?: () => void;
};

export function AudioRecorderTile({
  personaId,
  personaName,
  locked,
  onLockedClick,
  onUploaded,
}: AudioRecorderTileProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldSaveRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds);
  const [error, setError] = useState<string | null>(null);

  function clearTimers() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function cancelRecording() {
    shouldSaveRef.current = false;
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    stopStream();
    setRecording(false);
    setSecondsRemaining(PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds);
    setOpen(false);
  }

  useEffect(() => () => {
    shouldSaveRef.current = false;
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream();
  }, []);

  function saveAndStop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    shouldSaveRef.current = true;
    clearTimers();
    setRecording(false);
    setSecondsRemaining(0);
    recorder.stop();
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      chunksRef.current = [];
      shouldSaveRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const shouldSave = shouldSaveRef.current;
        shouldSaveRef.current = false;
        clearTimers();
        recorderRef.current = null;
        stopStream();
        setRecording(false);
        if (!shouldSave) return;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          setError("No audio was captured. Please try again.");
          return;
        }
        setSaving(true);
        const file = new File([blob], `voice-recording-${Date.now()}.webm`, { type: "audio/webm" });
        const result = await uploadPersonaAsset(personaId, file, "audio", "audio_recording", true);
        setSaving(false);
        if (result.ok) {
          onUploaded?.();
          setOpen(false);
          setSecondsRemaining(PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds);
        } else {
          setError(result.error);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      const startedAt = Date.now();
      setSecondsRemaining(PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds);
      intervalRef.current = window.setInterval(() => {
        setSecondsRemaining(Math.max(0, PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds - Math.floor((Date.now() - startedAt) / 1_000)));
      }, 250);
      timerRef.current = window.setTimeout(saveAndStop, PERSONA_UPLOAD_LIMITS.audioRecording.maxSeconds * 1_000);
      setRecording(true);
    } catch {
      stopStream();
      setError("Microphone access was denied or recording is unavailable.");
    }
  }

  return (
    <>
      <UploadTileShell
        label="Audio recorder"
        description="One voice recording per persona — re-recording replaces it"
        locked={locked}
        onLockedClick={onLockedClick}
      >
        <Button variant="secondary" className="w-full" onClick={() => { setError(null); setOpen(true); }}>
          Record voice
        </Button>
        {error && <p role="alert" className="font-text text-caption text-red-500">{error}</p>}
      </UploadTileShell>

      <Modal open={open} onClose={cancelRecording} maxWidthClassName="max-w-[34rem]" className="max-h-[calc(100dvh-3rem)] overflow-y-auto">
        <h2 className="font-display text-tagline text-ink">Record {personaName}&apos;s voice</h2>
        <p className="mt-xs font-text text-caption text-ink-muted-80">
          {recording ? `Recording — ${secondsRemaining}s remaining` : "Start when you are ready. It saves when you stop or when time runs out."}
        </p>
        <Button variant="secondary" className="mt-lg w-full" onClick={recording ? saveAndStop : startRecording} disabled={saving}>
          {saving ? "Saving…" : recording ? `Stop & save (${secondsRemaining}s)` : "Start recording"}
        </Button>
        <div className="mt-lg border-t border-hairline pt-lg">
          <RecordingConsent personaName={personaName} />
        </div>
        {error && <p role="alert" className="mt-sm font-text text-caption text-red-500">{error}</p>}
      </Modal>
    </>
  );
}
