"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/front_end/components/ui";
import { uploadPersonaAsset } from "@/front_end/state/persona-client";
import { PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";
import { PERSONA_UPLOAD_LIMITS } from "@/shared/persona-upload-limits";
import { preferredVideoRecording } from "./recording-media";
import { UploadTileShell } from "./UploadTileShell";

type PassiveFacialScanTileProps = {
  personaId: string;
  locked?: boolean;
  onLockedClick?: () => void;
  onUploaded?: () => void;
  deferTraining?: boolean;
};

export function PassiveFacialScanTile({
  personaId,
  locked,
  onLockedClick,
  onUploaded,
  deferTraining = false,
}: PassiveFacialScanTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldSaveRef = useRef(false);
  const finishingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds);
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
    shouldSaveRef.current = false;
    finishingRef.current = false;
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    stopCamera();
    setSecondsRemaining(PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds);
    setOpen(false);
  }

  useEffect(() => {
    if (scanning && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [scanning]);

  useEffect(() => () => {
    shouldSaveRef.current = false;
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopCamera();
  }, []);

  function finishScan() {
    const recorder = recorderRef.current;
    if (finishingRef.current || !recorder || recorder.state !== "recording") return;
    finishingRef.current = true;
    shouldSaveRef.current = true;
    clearTimers();
    setScanning(false);
    setSecondsRemaining(0);
    recorder.stop();
  }

  async function startScan() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 }, aspectRatio: { ideal: 4 / 3 } },
        audio: false,
      });
      const format = preferredVideoRecording();
      const recorder = format.mimeType ? new MediaRecorder(stream, { mimeType: format.mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      chunksRef.current = [];
      shouldSaveRef.current = false;
      finishingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const shouldSave = shouldSaveRef.current;
        shouldSaveRef.current = false;
        clearTimers();
        recorderRef.current = null;
        const motionType = recorder.mimeType || format.mimeType || "video/webm";
        const motionBlob = new Blob(chunksRef.current, { type: motionType });
        stopCamera();
        if (!shouldSave) {
          finishingRef.current = false;
          return;
        }
        if (motionBlob.size === 0) {
          finishingRef.current = false;
          setError("Couldn't save the passive facial scan. Please try again.");
          return;
        }

        setSaving(true);
        const extension = motionType.startsWith("video/mp4") ? "mp4" : "webm";
        const motion = new File([motionBlob], `passive-facial-scan-${Date.now()}.${extension}`, { type: motionType });
        const result = await uploadPersonaAsset(
          personaId,
          motion,
          "video",
          PERSONA_ASSET_SOURCES.passiveFacialScan,
          true,
          deferTraining,
        );
        setSaving(false);
        finishingRef.current = false;
        if (result.ok) {
          onUploaded?.();
          setOpen(false);
          setSecondsRemaining(PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds);
        } else {
          setError(result.error);
        }
      };
      recorder.start(250);
      recorderRef.current = recorder;
      const startedAt = Date.now();
      setSecondsRemaining(PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds);
      intervalRef.current = window.setInterval(() => {
        setSecondsRemaining(Math.max(0, PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds - Math.floor((Date.now() - startedAt) / 1_000)));
      }, 250);
      timerRef.current = window.setTimeout(finishScan, PERSONA_UPLOAD_LIMITS.passiveFacialScan.maxSeconds * 1_000);
      setScanning(true);
    } catch {
      stopCamera();
      setError("Camera permission was denied.");
    }
  }

  return (
    <>
      <UploadTileShell
        label="Passive facial scan"
        description="One 20-second natural-motion scan per persona — re-scanning replaces it"
        locked={locked}
        onLockedClick={onLockedClick}
      >
        <Button variant="secondary" className="w-full" onClick={() => { setError(null); setOpen(true); }}>
          Start passive scan
        </Button>
        {error && <p role="alert" className="font-text text-caption text-red-500">{error}</p>}
      </UploadTileShell>

      <Modal open={open} onClose={cancelScan} maxWidthClassName="max-w-[38rem]" className="max-h-[calc(100dvh-3rem)] overflow-y-auto">
        <h2 className="font-display text-tagline text-ink">Passive facial scan</h2>
        <p className="mt-xs font-text text-caption text-ink-muted-80">
          {scanning
            ? `Scanning natural movement — ${secondsRemaining}s remaining`
            : "Look toward the camera and stay relaxed. Blink, breathe, and make small natural movements without speaking."}
        </p>
        {scanning && <video ref={videoRef} autoPlay muted playsInline className="mt-lg aspect-[4/3] w-full rounded-md bg-surface-black object-cover" />}
        <Button variant="secondary" className="mt-lg w-full" onClick={scanning ? finishScan : startScan} disabled={saving}>
          {saving ? "Saving…" : scanning ? `Stop & save (${secondsRemaining}s)` : "Start passive scan"}
        </Button>
        {error && <p role="alert" className="mt-sm font-text text-caption text-red-500">{error}</p>}
      </Modal>
    </>
  );
}
