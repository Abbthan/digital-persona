export type RecordingMediaFormat = {
  mimeType: string;
  extension: "mp4" | "webm" | "m4a";
};

function firstSupported(mimeTypes: readonly string[]) {
  if (typeof MediaRecorder === "undefined") return "";
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

/**
 * Safari can record H.264/AAC MP4 directly. Chromium normally cannot, so it
 * records WebM honestly; the GPU media gateway converts that source to H.264
 * MP4 before MuseTalk/LiveTalking sees it.
 */
export function preferredVideoRecording(): RecordingMediaFormat {
  const mimeType = firstSupported([
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]);
  return { mimeType, extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
}

/**
 * CozyVoice consumes normalized WAV on the GPU service. Browsers that support
 * AAC save M4A; Chromium's WebM/Opus fallback is normalized server-side.
 */
export function preferredAudioRecording(): RecordingMediaFormat {
  const mimeType = firstSupported([
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]);
  return { mimeType, extension: mimeType.startsWith("audio/mp4") ? "m4a" : "webm" };
}
