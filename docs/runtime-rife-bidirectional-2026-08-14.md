# Runtime bidirectional RIFE transition — 2026-08-14

## Outcome

Runtime RIFE is enabled as a fail-open transition layer on the physical A800
server. It affects only the boundary between the existing passive-idle loop and
the existing MuseTalk talking renderer:

- idle → talking: last emitted idle frame to first rendered talking frame;
- talking → idle: last rendered talking frame to the pose-matched idle frame.

It does not replace MuseTalk, LiveTalking, LivePortrait preparation, CosyVoice,
WebRTC, or persona data. It does not use the offline transition bank.

## Frame and audio behavior

RIFE emits three frames at quarter, midpoint, and three-quarter progress. The
runtime scheduler replaces the next three ordinary video frames with those
frames. It never inserts additional video packets. The 25 fps video and 50 fps
audio packet counts therefore remain unchanged, avoiding timestamp drift caused
solely by the transition.

The interpolation call is synchronous at the state boundary. The existing
WebRTC cushion absorbs most of that delay; the user explicitly accepted the
latency trade-off for this experiment. If the localhost request exceeds 750 ms
or fails validation, the current mouth-neutralization transition is used.

## Isolation and rollback

- RIFE listener: `127.0.0.1:9030` only
- assigned device: GPU 5
- model: ModelScope RIFE HDv3 checkpoint
- checkpoint SHA-256:
  `fe854fc8996547c953f732aaa3b78cae76cc0a12833ae856ea0749c4c570d7d8`
- production renderer: MuseTalk on GPU 0, unchanged
- feature flag: `RIFE_TRANSITION_ENABLED`
- fallback: nearest-pose selection plus mouth neutralization

Timestamped pre-change copies remain on the GPU host:

- `LiveTalking/avatars/base_avatar.py.pre-runtime-rife-20260814`
- `start-livetalking.sh.pre-runtime-rife-20260814`

Setting `RIFE_TRANSITION_ENABLED=0` and restarting only LiveTalking disables the
new path without removing code or stopping any other model service.

## Verification

Local test suite: 12 tests passed, with the single OpenCV-only offline-bank test
skipped on macOS. GPU runtime tests passed with OpenCV installed.

Real Ethan persona frames at 960×720 were tested in both directions:

| Direction | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| idle → talking | 195.993 ms | 204.606 ms | 204.606 ms |
| talking → idle | 194.366 ms | 210.326 ms | 210.326 ms |

The runtime scheduler consumed three frames in each direction and returned to
the live destination frame without changing frame counts. After activation:

- port 8010 (LiveTalking): listening;
- port 9030 (RIFE): listening;
- GPU 5: approximately 959 MiB allocated, 0% utilization while idle;
- RIFE HTTP 4xx/5xx responses: zero;
- LiveTalking Python tracebacks after restart: zero;
- RIFE fallback events after restart: zero.

The production browser connected and initialized the feature. Browser security
correctly refused an automated chat-message submission, so the test did not add
or alter account chat history. The non-public scheduler/model integration test
therefore provides the verified bidirectional boundary coverage for this
deployment.

## Deployment patches

- `0028-runtime-rife-bidirectional.patch`: connects the session state boundary
  to the fail-open scheduler.
- `0029-livetalking-runtime-rife-env.patch`: exposes the local feature flags and
  repository import path.
- `0030-start-runtime-rife-with-livetalking.patch`: best-effort localhost RIFE
  startup without making LiveTalking depend on it.
