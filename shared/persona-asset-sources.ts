export const PERSONA_ASSET_SOURCES = {
  upload: "upload",
  audioRecording: "audio_recording",
  legacyCameraRecording: "camera_recording",
  guidedFacialScan: "facial_camera",
  passiveFacialScan: "idle_facial_camera",
} as const;

export type PersonaAssetSource = typeof PERSONA_ASSET_SOURCES[keyof typeof PERSONA_ASSET_SOURCES];

export function isDedicatedFacialVideoSource(source: unknown): boolean {
  return source === PERSONA_ASSET_SOURCES.guidedFacialScan || source === PERSONA_ASSET_SOURCES.passiveFacialScan;
}
