import assert from "node:assert/strict";
import type { AssetType } from "@/generated/prisma/client";
import { selectAvatarSourceAsset } from "@/back_end/services/persona-training";
import { PERSONA_ASSET_SOURCES } from "@/shared/persona-asset-sources";

type TestAsset = {
  id: string;
  type: AssetType;
  url: string;
  metadata: { originalName: string; source: string };
};

function asset(id: string, type: AssetType, source: string): TestAsset {
  return { id, type, url: `private/${id}`, metadata: { originalName: `${id}.mp4`, source } };
}

const reference = asset("reference", "facial_scan", PERSONA_ASSET_SOURCES.guidedFacialScan);
const guided = asset("guided", "video", PERSONA_ASSET_SOURCES.guidedFacialScan);
const passive = asset("passive", "video", PERSONA_ASSET_SOURCES.passiveFacialScan);
const ordinaryVideo = asset("ordinary", "video", PERSONA_ASSET_SOURCES.upload);
const ordinaryPhoto = asset("photo", "image", PERSONA_ASSET_SOURCES.upload);

assert.equal(selectAvatarSourceAsset([]), null, "nothing usable must stay chat-only");
assert.equal(
  selectAvatarSourceAsset([reference, guided]),
  null,
  "guided-only with no fallback asset must stay chat-only",
);
assert.equal(
  selectAvatarSourceAsset([reference, guided, ordinaryVideo])?.id,
  ordinaryVideo.id,
  // Changed by the "Recording with talking" redesign: the dedicated trio
  // (facial_scan + guided/talking scan + passive scan) is still required
  // for MuseTalk's primary baked avatar, but when it's incomplete, an
  // ordinary upload now substitutes rather than leaving the persona
  // chat-only. A real video is preferred over a photo — the GPU trainer
  // loops a photo-only source into a short clip (see
  // submitAvatarTrainingJob's docstring), so it still degrades gracefully.
  "an ordinary uploaded video must substitute when the dedicated trio is incomplete",
);
assert.equal(
  selectAvatarSourceAsset([reference, guided, ordinaryPhoto])?.id,
  ordinaryPhoto.id,
  "an ordinary uploaded photo must substitute when no fallback video exists either",
);
assert.equal(
  selectAvatarSourceAsset([reference, passive]),
  null,
  "a passive scan without the guided scan and no fallback asset must stay chat-only",
);
assert.equal(
  selectAvatarSourceAsset([reference, guided, passive])?.id,
  guided.id,
  // Changed by the LivePortrait idle-loop work (docs/gpu-liveportrait-integration.md):
  // the passive scan no longer needs to double as MuseTalk's only motion
  // source now that it's baked separately as an idle-only loop
  // (personaIdleActionConfig / data/avatars/<id>/idle_imgs). The guided
  // scan's genuinely recorded talking motion is what shows during actual
  // speech instead of a flat closed-mouth loop.
  "the guided/talking scan must be the primary avatar source once the dedicated trio exists",
);
assert.equal(
  selectAvatarSourceAsset([reference, guided, passive, ordinaryVideo])?.id,
  guided.id,
  "the dedicated trio must win over an available fallback asset, not just in its absence",
);

console.info("persona training source-selection: PASS");
