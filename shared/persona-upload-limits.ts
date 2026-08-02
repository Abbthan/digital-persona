export const PERSONA_UPLOAD_LIMITS = {
  image: { free: 5, paid: 30, maxBytes: 5 * 1024 * 1024 },
  document: { free: 5, paid: 20, maxBytes: 5 * 1024 * 1024 },
  audioUpload: { free: 3, paid: 10, maxBytes: 1 * 1024 * 1024 },
  video: { max: 3, maxBytes: 20 * 1024 * 1024, maxSeconds: 15 },
  facialScan: { max: 1, maxSeconds: 40 },
  audioRecording: { max: 1, maxSeconds: 40 },
} as const;

export function planLimit(limit: { free: number; paid: number }, isPaid: boolean) {
  return isPaid ? limit.paid : limit.free;
}
