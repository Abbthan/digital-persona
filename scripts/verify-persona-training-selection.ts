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

assert.equal(selectAvatarSourceAsset([]), null, "no scans must stay chat-only");
assert.equal(selectAvatarSourceAsset([reference, guided]), null, "guided-only must stay chat-only");
assert.equal(
  selectAvatarSourceAsset([reference, guided, ordinaryVideo]),
  null,
  "an ordinary upload must not substitute for the passive scan",
);
assert.equal(
  selectAvatarSourceAsset([reference, passive]),
  null,
  "a passive scan without the guided scan must stay chat-only",
);
assert.equal(
  selectAvatarSourceAsset([reference, guided, passive])?.id,
  passive.id,
  "the passive scan must be the LiveTalking motion source once both scans exist",
);

console.info("persona two-scan training selection: PASS");
