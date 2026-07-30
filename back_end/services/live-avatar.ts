/**
 * Live-avatar boundary.
 *
 * Route handlers and training orchestration should import avatar/WebRTC
 * operations here rather than reaching into the combined GPU gateway. This
 * makes LiveTalking replaceable without coupling it to STT, TTS, or RAG.
 * The legacy gateway remains the transport implementation for now so no
 * production endpoint or secret changes during this refactor.
 */
export {
  LIVE_SESSION_TOKEN_TTL_SECONDS,
  checkFaceMatch,
  createLiveSessionToken,
  deletePersonaGpuFiles,
  getAvatarReadiness,
  getAvatarTrainingTask,
  isLiveTalkingConfigured,
  liveTalkingServerUrl,
  setLiveAvatarIdleAction,
  submitAvatarTrainingJob,
  turnServerConfig,
} from "@/back_end/services/livetalking";

export type { AvatarTrainingTask, LiveSessionTokenPayload } from "@/back_end/services/livetalking";
