# Ditto backup candidate build — 2026-08-13

## Scope and isolation

This is an offline backup-renderer experiment. It did not modify, import into,
restart, or reconfigure production LiveTalking, MuseTalk, CosyVoice, tunnels,
Cloudflare, the web application, or a public route. It did not start a
persistent service.

- Server: physical 8× NVIDIA A800-SXM4-80GB host
- Experiment root: `/data/echodigitalpersona/Ditto-experiment`
- Ditto source commit: `c3e47eee2e626500017a0556b470d6d4182f85e8`
- Build and smoke-test GPU: GPU 6 only (`CUDA_VISIBLE_DEVICES=6`)
- Final GPU 6 state: 5 MiB used, 0% utilization
- Public listeners added: none

## Official sources and selected artifacts

Source code and conversion script:

- <https://github.com/antgroup/ditto-talkinghead>
- Official script: `scripts/cvt_onnx_to_trt.py`

Model source:

- <https://huggingface.co/digital-avatar/ditto-talkinghead>
- The server cannot reliably reach `huggingface.co` directly. Downloads used
  `https://hf-mirror.com/digital-avatar/ditto-talkinghead/resolve/main/`, which
  redirects to the official Hugging Face CDN objects.
- The official Hugging Face model-tree LFS `oid` values were treated as the
  SHA-256 allowlist. Every retained downloaded artifact matched its official
  hash before use.

Retained official model inputs:

| Artifact | Bytes | Official SHA-256 |
|---|---:|---|
| `ditto_cfg/v0.4_hubert_cfg_trt_online.pkl` | 30,924 | `7f82e1e383b3a29f390921846dd4b9a22794d96d8d835391e6cfda87782b7044` |
| `ditto_onnx/warp_network.onnx` | 199,684,267 | `88f829070c6f5671f809e5ac4825320a8096fb0484fe72a67038d5515e52dba9` |
| `ditto_onnx/libgrid_sample_3d_plugin.so` | 2,377,784 | `0c9ad18e582231247f276eba9df17b46c74e1eb8fbddeb37cbcd73f36874277c` |
| `appearance_extractor_fp16.engine` | 2,182,172 | `8aac43f36a5a8c28b73504422063a3f5e4e3f4e1eb753b41404c5efcd12d0d34` |
| `blaze_face_fp16.engine` | 1,090,452 | `0da1dd976fadc55cf58291d49a567f031f208eab05de1fad4270deafc70daed2` |
| `decoder_fp16.engine` | 113,774,428 | `e63716e70e28f10beab571fd96ba68d4af67c669a4a493c128a54f4f205c02a5` |
| `face_mesh_fp16.engine` | 9,238,932 | `488dba7cc5e5d3e69fa72696cf7a691e8b8c2b7c67044506c8b0d259f70c8d21` |
| `hubert_fp32.engine` | 1,460,129,364 | `b05f0d13db35e064d78242d9f5e5269d4fab45808a67fe57b823550929278dec` |
| `insightface_det_fp16.engine` | 9,662,916 | `43b7989a62445c2d3b0f82c2fc18bf9eea3f82a66158c4f0d804eea0ee9a0aac` |
| `landmark106_fp16.engine` | 4,255,388 | `0c17c706c774525cf4d8b995a6af47e09d3b644dcdc5d22c87be11141b082a06` |
| `landmark203_fp16.engine` | 58,135,076 | `314e53dff4591e37c495e59b852bf6a081446cf9c9e12d0b033de772cccc98b9` |
| `lmdm_v0.4_hubert_fp32.engine` | 195,143,300 | `a49ab8eb962ac4f1c9a8741540df5ab4f3d534fc2d0b6c86402f49e134dfd8a7` |
| `motion_extractor_fp32.engine` | 119,783,260 | `e43f744d73da1a3d9576a6def56d72f8ac22795cc958be44cab64ede9c46150d` |
| `stitch_network_fp16.engine` | 381,356 | `14b87de206a7b4228971543fadf939f7bba4803726e76583bbd79c1e5f415fca` |

The official repository does not currently include the
`warp_network_fp16.engine` named by its README. That engine was built locally
from the official ONNX graph and plugin, as described below.

## Isolated environment

- Python 3.10.20
- PyTorch 2.5.1+cu121 (CUDA 12.1)
- TensorRT 8.6.1
- NumPy 2.0.1
- OpenCV 4.10.0
- librosa 0.10.2.post1
- FFmpeg 4.4.2
- NVIDIA driver 535.129.03
- Hugging Face Hub 0.34.4
- `hf_xet` 1.1.8
- `hf_transfer` 0.1.9

TensorRT 8.6.1 uses an isolated cuDNN 8 library layer rather than replacing
the environment's PyTorch cuDNN libraries:

```shell
export LD_LIBRARY_PATH="$PWD/.trt-libs/nvidia/cudnn/lib:$PWD/.conda/lib/python3.10/site-packages/tensorrt_libs"
```

All package caches and temporary model content were kept below the experiment
root on `/data`. The nearly full root filesystem was not used for downloads.

## Download behavior

Ordinary `wget` and the default sequential Hub client repeatedly timed out on
the Hugging Face CDN. The successful path used the official `hf_transfer`
client with bounded parallel connections and SHA-256 validation after each
file. The largest 1.46 GB HuBERT engine required resumable HTTP range pieces;
the pieces were concatenated and the complete result matched the official LFS
SHA-256 exactly.

Failed/incomplete transfer files remain only under the isolated experiment
directory. They are not in the assembled model set and are not referenced by
the smoke test. They account for approximately 2.7 GB under `.tmp` (principally
the range pieces used to reconstruct HuBERT, two abandoned full-file attempts,
and an early warp attempt), plus a 10 MB Hub `.incomplete` file and a 183 KB
`.engine.part` file. They were inventoried but deliberately not deleted during
this build because cleanup is a separate destructive action.

## Missing warp-engine build

The conversion was run only for `warp_network.onnx` because it was the only
ONNX file placed in `checkpoints/ditto_onnx`:

```shell
export CUDA_VISIBLE_DEVICES=6
export TMPDIR="$PWD/.tmp"
export XDG_CACHE_HOME="$PWD/.cache"
export LD_LIBRARY_PATH="$PWD/.trt-libs/nvidia/cudnn/lib:$PWD/.conda/lib/python3.10/site-packages/tensorrt_libs"

.conda/bin/python scripts/cvt_onnx_to_trt.py \
  --onnx_dir checkpoints/ditto_onnx \
  --trt_dir checkpoints/ditto_trt_custom
```

Result:

- `checkpoints/ditto_trt_custom/warp_network_fp16.engine`
- 107,278,820 bytes
- locally generated SHA-256:
  `4488bd5bc9b6b8db76e8e63ed3cad355434eed52e2788bd53e8ecee5a8340648`
- copied into the complete isolated
  `checkpoints/ditto_trt_Ampere_Plus/` directory

The official GridSample3D plugin was loaded successfully twice. TensorRT logged
the expected ONNX INT64-to-INT32 conversion warning and FP16 subnormal-weight
warnings. One tactic emitted `NVRTC Compilation failure`; the builder selected
other tactics and subsequently emitted a valid engine. This is not being
silently ignored: the engine passed deserialization and full offline inference
below. The full build log is retained at
`/data/echodigitalpersona/Ditto-experiment/.tmp/build/warp_network_build.log`.

## Validation

### Engine loading

With the official GridSample3D plugin loaded, all 12 assembled TensorRT
engines deserialized successfully on GPU 6. The locally generated warp engine
exposed four bindings. No engine failed deserialization.

### Bounded offline smoke test

The official example image and audio were run through the official
`inference.py` entry point. A copy of the online configuration was used only
for this smoke test, with:

- `max_size=512`
- one diffusion sampling step
- one source template frame
- no service and no network listener

Output:

- path: `/data/echodigitalpersona/Ditto-experiment/.tmp/smoke/result.mp4`
- H.264 video, 512×512, 25 fps
- AAC audio
- duration: 15.755 seconds
- size: 192,776 bytes
- SHA-256:
  `b21fcefd19f9e7e28150b01a96e92dc7b89d74c1dc827b5db131910c5b72cd87`

The test completed successfully. This proves that the isolated official
TensorRT graph, including the locally generated warp engine, can perform a
complete offline render on this A800 server. It does **not** prove production
quality, streaming first-frame latency, real-time steady-state throughput,
bilingual phoneme alignment, customer-persona quality, or production
integration.

## Current status and next gates

Ditto is now a functioning offline backup candidate, not a production
renderer. No persistent process remains. Before any integration, it still
needs:

1. Full-quality benchmarking with the official sampling count, not the
   one-step smoke setting.
2. Online chunked-stream benchmark: time to first frame, steady-state fps,
   GPU memory, and latency under concurrent sessions.
3. Side-by-side English and Chinese lip-sync review using controlled audio.
4. Real persona image/video experiments and identity-preservation review.
5. Idle/listening motion and talk/idle transition design, since offline Ditto
   success does not by itself supply the website's entire session state
   machine.
6. A separate bounded local service on GPU 6 or another explicitly assigned
   GPU, with MuseTalk/LiveTalking preserved as an immediate fallback.
7. A feature flag and rollback plan. Production must not be switched merely
   because this offline smoke test passed.
