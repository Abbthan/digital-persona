"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/front_end/components/ui";
import { uploadPersonaAsset } from "@/front_end/state/persona-client";
import { PERSONA_UPLOAD_LIMITS } from "@/shared/persona-upload-limits";
import { preferredVideoRecording } from "./recording-media";
import { UploadTileShell } from "./UploadTileShell";

type VideoRecorderTileProps = {
  personaId: string;
  locked?: boolean;
  onLockedClick?: () => void;
  onUploaded?: () => void;
};

export function VideoRecorderTile({ personaId, locked, onLockedClick, onUploaded }: VideoRecorderTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(PERSONA_UPLOAD_LIMITS.video.maxSeconds);
  const [error, setError] = useState<string | null>(null);

  function clearRecordingTimers() {
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
    if (recordingIntervalRef.current !== null) window.clearInterval(recordingIntervalRef.current);
    recordingTimerRef.current = null;
    recordingIntervalRef.current = null;
  }

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOpen]);

  useEffect(() => () => {
    clearRecordingTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function openCamera() {
    setError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setCameraOpen(true);
    } catch {
      setError("Camera or microphone access was denied.");
    }
  }

  function stopCamera() {
    clearRecordingTimers();
    if (recording) recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setSecondsRemaining(PERSONA_UPLOAD_LIMITS.video.maxSeconds);
    setCameraOpen(false);
  }

  function toggleRecording() {
    if (recording) {
      clearRecordingTimers();
      recorderRef.current?.stop();
      setRecording(false);
      setSecondsRemaining(PERSONA_UPLOAD_LIMITS.video.maxSeconds);
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    const format = preferredVideoRecording();
    const recorder = format.mimeType ? new MediaRecorder(stream, { mimeType: format.mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      clearRecordingTimers();
      recorderRef.current = null;
      const type = recorder.mimeType || format.mimeType || "video/webm";
      const extension = type.startsWith("video/mp4") ? "mp4" : "webm";
      const file = new File([new Blob(chunksRef.current, { type })], `camera-recording-${Date.now()}.${extension}`, { type });
      const result = await uploadPersonaAsset(personaId, file, "video", "camera_recording");
      if (result.ok) {
        setSaved((current) => current + 1);
        onUploaded?.();
      } else {
        setError(result.error);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    const startedAt = Date.now();
    setSecondsRemaining(PERSONA_UPLOAD_LIMITS.video.maxSeconds);
    recordingIntervalRef.current = window.setInterval(() => {
      setSecondsRemaining(Math.max(0, PERSONA_UPLOAD_LIMITS.video.maxSeconds - Math.floor((Date.now() - startedAt) / 1_000)));
    }, 250);
    recordingTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
      setRecording(false);
      setSecondsRemaining(0);
    }, PERSONA_UPLOAD_LIMITS.video.maxSeconds * 1_000);
    setRecording(true);
  }

  return (
    <UploadTileShell label="Video recorder" description="Up to 3 camera videos, 15 seconds each — prepared as MP4 for avatar training" locked={locked} onLockedClick={onLockedClick}>
      {cameraOpen ? (
        <div className="flex flex-col gap-xs">
          <video ref={videoRef} autoPlay muted playsInline className="h-32 w-full rounded-md bg-surface-black object-cover" />
          <div className="flex gap-xs">
            <Button variant="secondary" className="flex-1" onClick={toggleRecording}>{recording ? `Stop & save (${secondsRemaining}s)` : "Start recording"}</Button>
            <Button variant="secondary" className="flex-1" onClick={stopCamera}>Close camera</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="w-full" onClick={openCamera}>{saved > 0 ? `${saved} saved — record more` : "Open camera"}</Button>
      )}
      {error && <p role="alert" className="font-text text-caption text-red-500">{error}</p>}
    </UploadTileShell>
  );
}
