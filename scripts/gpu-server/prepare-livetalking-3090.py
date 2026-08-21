#!/usr/bin/env python3
"""Apply ECHO's minimal, idempotent runtime fixes to upstream LiveTalking.

This deliberately excludes account/media authentication, STT, memory, and
training orchestration. Those responsibilities live in the versioned ECHO
gateway and its separate services. The patch surface here is limited to bugs
inside the WebRTC renderer that cannot be fixed by an HTTP proxy.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return False
    if old not in text:
        raise RuntimeError(f"expected upstream block was not found in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    return True


def patch_base_avatar(root: Path) -> bool:
    return replace_once(
        root / "avatars/base_avatar.py",
        """    def set_custom_state(self, audiotype, reinit=True):
        print('set_custom_state:', audiotype)
        if self.custom_audio_index.get(audiotype) is None:
            return
        self.custom_audiotype = audiotype
        if reinit:
            self.custom_audio_index[audiotype] = 0
            self.custom_index[audiotype] = 0
""",
        """    def set_custom_state(self, audiotype, reinit=True):
        print('set_custom_state:', audiotype)
        # ECHO's passive scan is an image-only idle action. Silence comes
        # from the normal ASR stream, so requiring a custom audio clip makes
        # the recorded breathing/blinking loop impossible to activate.
        if self.custom_index.get(audiotype) is None:
            return
        self.custom_audiotype = audiotype
        if reinit:
            if audiotype in self.custom_audio_index:
                self.custom_audio_index[audiotype] = 0
            self.custom_index[audiotype] = 0
""",
    )


def patch_genavatar(root: Path) -> bool:
    path = root / "avatars/musetalk/genavatar.py"
    changed = replace_once(
        path,
        """def video2imgs(vid_path, save_path, ext='.png', cut_frame=10000000):
    cap = cv2.VideoCapture(vid_path)
    count = 0
    while True:
""",
        """def video2imgs(vid_path, save_path, ext='.png', cut_frame=10000000):
    cap = cv2.VideoCapture(vid_path)
    count = 0
    if not cap.isOpened():
        raise ValueError(f\"Could not open avatar video: {vid_path}\")
    while True:
""",
    )
    changed |= replace_once(
        path,
        """        else:
            break


def is_video_file(file_path):
    video_exts = ['.mp4', '.mkv', '.flv', '.avi', '.mov']
""",
        """        else:
            break
    cap.release()
    if count == 0:
        raise ValueError(f\"Avatar video contains no decodable frames: {vid_path}\")


def is_video_file(file_path):
    video_exts = ['.mp4', '.mkv', '.flv', '.avi', '.mov', '.webm']
""",
    )
    changed |= replace_once(
        path,
        """    input_img_list = sorted(glob.glob(os.path.join(save_full_path, '*.[jpJP][pnPN]*[gG]')))
    print(\"extracting landmarks...\")
    coord_list, frame_list = get_landmark_and_bbox(input_img_list, bbox_shift)
""",
        """    input_img_list = sorted(glob.glob(os.path.join(save_full_path, '*.[jpJP][pnPN]*[gG]')))
    print(\"extracting landmarks...\")
    if not input_img_list:
        raise ValueError(\"Avatar source produced no images for landmark extraction\")
    coord_list, frame_list = get_landmark_and_bbox(input_img_list, bbox_shift)
    if not frame_list:
        raise ValueError(\"Avatar source produced no usable frames after landmark extraction\")
""",
    )
    changed |= replace_once(
        path,
        """    input_latent_list = []
    idx = -1
    coord_placeholder = (0.0, 0.0, 0.0, 0.0)

    device = torch.device(f\"cuda\" if torch.cuda.is_available() else \"cpu\")
""",
        """    input_latent_list = []
    idx = -1
    coord_placeholder = (0.0, 0.0, 0.0, 0.0)

    # Face detection can miss an isolated frame even when the surrounding
    # recording is valid. The upstream mask loop passes the all-zero
    # placeholder to PIL, which produces a 0x0 crop and aborts the complete
    # persona build. Reuse the nearest detected box and clamp every box to its
    # own frame so one blink/edge frame cannot invalidate the whole scan.
    valid_coord_indexes = [
        index
        for index, bbox in enumerate(coord_list)
        if bbox != coord_placeholder and bbox[2] > bbox[0] and bbox[3] > bbox[1]
    ]
    if not valid_coord_indexes:
        raise ValueError(\"No usable face bounding boxes were detected in the avatar source\")
    for index, frame in enumerate(frame_list):
        bbox = coord_list[index]
        if bbox == coord_placeholder or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            nearest = min(valid_coord_indexes, key=lambda candidate: abs(candidate - index))
            bbox = coord_list[nearest]
        frame_height, frame_width = frame.shape[:2]
        x1 = max(0, min(int(bbox[0]), frame_width - 1))
        y1 = max(0, min(int(bbox[1]), frame_height - 1))
        x2 = max(x1 + 1, min(int(bbox[2]), frame_width))
        y2 = max(y1 + 1, min(int(bbox[3]), frame_height))
        coord_list[index] = [x1, y1, x2, y2]

    device = torch.device(f\"cuda\" if torch.cuda.is_available() else \"cpu\")
""",
    )
    return changed


def patch_musetalk_blending(root: Path) -> bool:
    """Keep OpenCV's crop, face, and mask arrays dimensionally identical.

    Avatar preparation metadata can be one pixel outside a decoded frame after
    codec rounding. Upstream passes the original mask to ``blendLinear`` even
    when the effective crop has been clamped, which raises an assertion and
    drops the complete talking frame. Normalize all inputs at this final
    compositor boundary so a recoverable metadata mismatch cannot flicker the
    stream.
    """

    return replace_once(
        root / "avatars/musetalk/myutil.py",
        """def get_image_blending(image,face,face_box,mask_array,crop_box):
    body = image
    x, y, x1, y1 = face_box
    x_s, y_s, x_e, y_e = crop_box
    face_large = body[y_s:y_e, x_s:x_e].copy()
    face_large[y-y_s:y1-y_s, x-x_s:x1-x_s]=face

    mask_image = cv2.cvtColor(mask_array,cv2.COLOR_BGR2GRAY)
    mask_image = (mask_image/255).astype(np.float32)

    # mask_not = cv2.bitwise_not(mask_array)
    # prospect_tmp = cv2.bitwise_and(face_large, face_large, mask=mask_array)
    # background_img = body[y_s:y_e, x_s:x_e]
    # background_img = cv2.bitwise_and(background_img, background_img, mask=mask_not)
    # body[y_s:y_e, x_s:x_e] = prospect_tmp + background_img

    #print(mask_image.shape)
    #print(cv2.minMaxLoc(mask_image))

    body[y_s:y_e, x_s:x_e] = cv2.blendLinear(face_large,body[y_s:y_e, x_s:x_e],mask_image,1-mask_image)

    #body.paste(face_large, crop_box[:2], mask_image)
    return body""",
        """def get_image_blending(image, face, face_box, mask_array, crop_box):
    body = image
    x, y, x1, y1 = [int(value) for value in face_box]
    x_s, y_s, x_e, y_e = [int(value) for value in crop_box]
    height, width = body.shape[:2]

    x_s, x_e = max(0, x_s), min(width, x_e)
    y_s, y_e = max(0, y_s), min(height, y_e)
    if x_e <= x_s or y_e <= y_s:
        return body

    background = body[y_s:y_e, x_s:x_e]
    face_large = background.copy()
    insert_x0 = max(0, x - x_s)
    insert_y0 = max(0, y - y_s)
    insert_x1 = min(face_large.shape[1], x1 - x_s)
    insert_y1 = min(face_large.shape[0], y1 - y_s)
    if insert_x1 > insert_x0 and insert_y1 > insert_y0:
        insert_width = insert_x1 - insert_x0
        insert_height = insert_y1 - insert_y0
        if face.shape[:2] != (insert_height, insert_width):
            face = cv2.resize(
                face,
                (insert_width, insert_height),
                interpolation=cv2.INTER_LINEAR,
            )
        face_large[insert_y0:insert_y1, insert_x0:insert_x1] = face

    if mask_array.ndim == 3:
        mask_image = cv2.cvtColor(mask_array, cv2.COLOR_BGR2GRAY)
    else:
        mask_image = mask_array
    if mask_image.shape[:2] != face_large.shape[:2]:
        mask_image = cv2.resize(
            mask_image,
            (face_large.shape[1], face_large.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
    mask_image = np.ascontiguousarray(
        np.clip(mask_image.astype(np.float32) / 255.0, 0.0, 1.0)
    )

    body[y_s:y_e, x_s:x_e] = cv2.blendLinear(
        face_large,
        background,
        mask_image,
        np.ascontiguousarray(1.0 - mask_image),
    )
    return body""",
    )


def patch_rtc_manager(root: Path) -> bool:
    path = root / "server/rtc_manager.py"
    changed = replace_once(
        path,
        """import json
import asyncio
import random
""",
        """import json
import asyncio
import os
import random
""",
    )
    changed |= replace_once(
        path,
        """        self.opt = opt
        self.pcs: set = set()

    async def _create_pc_and_answer(self, avatar_session, sessionid, offer):
""",
        """        self.opt = opt
        self.pcs: set = set()
        self.session_pcs: dict[str, RTCPeerConnection] = {}

    async def close_session(self, sessionid: str):
        \"\"\"Release a peer and its renderer idempotently.\"\"\"
        pc = self.session_pcs.pop(sessionid, None)
        if pc is not None:
            if pc.connectionState != \"closed\":
                await pc.close()
            self.pcs.discard(pc)
        session_manager.remove_session(sessionid)

    async def _create_pc_and_answer(self, avatar_session, sessionid, offer):
""",
    )
    changed |= replace_once(
        path,
        """        ice_server = RTCIceServer(urls=self.opt.stun)
        pc = RTCPeerConnection(
            configuration=RTCConfiguration(iceServers=[ice_server])
        )
""",
        """        ice_servers = [RTCIceServer(urls=self.opt.stun)]
        turn_url = os.environ.get("TURN_SERVER_URL", "").strip()
        turn_username = os.environ.get("TURN_USERNAME", "").strip()
        turn_credential = os.environ.get("TURN_CREDENTIAL", "").strip()
        if turn_url and turn_username and turn_credential:
            turn_urls = [url.strip() for url in turn_url.split(",") if url.strip()]
            ice_servers.append(
                RTCIceServer(
                    urls=turn_urls,
                    username=turn_username,
                    credential=turn_credential,
                )
            )
        pc = RTCPeerConnection(
            configuration=RTCConfiguration(iceServers=ice_servers)
        )
""",
    )
    changed |= replace_once(
        path,
        """        )
        self.pcs.add(pc)

        @pc.on(\"connectionstatechange\")
""",
        """        )
        self.pcs.add(pc)
        self.session_pcs[sessionid] = pc

        @pc.on(\"connectionstatechange\")
""",
    )
    changed |= replace_once(
        path,
        """            if pc.connectionState in (\"failed\", \"closed\"):
                await pc.close()
                self.pcs.discard(pc)
                session_manager.remove_session(sessionid)

        # 添加发送轨道
""",
        """            if pc.connectionState in (\"failed\", \"closed\"):
                await self.close_session(sessionid)

        async def reap_unconnected_session():
            await asyncio.sleep(45)
            if pc.connectionState not in (\"connected\", \"closed\"):
                logger.warning(
                    \"Closing unconnected session %s after ICE timeout (state=%s)\",
                    sessionid,
                    pc.connectionState,
                )
                await self.close_session(sessionid)

        asyncio.create_task(reap_unconnected_session())

        # 添加发送轨道
""",
    )
    changed |= replace_once(
        path,
        """            return web.Response(
                content_type=\"application/json\",
                text=json.dumps({\"code\": -1, \"msg\": str(e)}),
            )
""",
        """            return web.Response(
                status=503,
                content_type=\"application/json\",
                text=json.dumps({\"code\": -1, \"msg\": str(e)}),
            )
""",
    )
    changed |= replace_once(
        path,
        """        await asyncio.gather(*coros)
        self.pcs.clear()
""",
        """        await asyncio.gather(*coros)
        self.pcs.clear()
        self.session_pcs.clear()
""",
    )
    return changed


def patch_routes(root: Path) -> bool:
    path = root / "server/routes.py"
    changed = replace_once(
        path,
        """def json_error(msg: str, code: int = -1):
    \"\"\"返回错误 JSON 响应\"\"\"
    return web.Response(
        content_type=\"application/json\",
        text=json.dumps({\"code\": code, \"msg\": str(msg)}),
    )
""",
        """def json_error(msg: str, code: int = -1, status: int = 400):
    \"\"\"Return a non-2xx status so callers never parse an error as SDP.\"\"\"
    return web.Response(
        status=status,
        content_type=\"application/json\",
        text=json.dumps({\"code\": code, \"msg\": str(msg)}),
    )
""",
    )
    changed |= replace_once(
        path,
        """async def index(request):
    \"\"\"默认首页重定向\"\"\"
""",
        """async def close_session(request):
    \"\"\"Explicitly release a browser WebRTC session on navigation/unload.\"\"\"
    try:
        params = await request.json()
        sessionid = str(params.get(\"sessionid\") or \"\")
        if not sessionid:
            return json_error(\"sessionid is required\")
        rtc_manager = request.app.get(\"rtc_manager\")
        if rtc_manager is None:
            return json_error(\"RTC manager is unavailable\", status=503)
        await rtc_manager.close_session(sessionid)
        return json_ok()
    except Exception as error:
        logger.exception(\"close_session exception:\")
        return json_error(str(error))


async def index(request):
    \"\"\"默认首页重定向\"\"\"
""",
    )
    changed |= replace_once(
        path,
        """    app.router.add_post(\"/is_speaking\", is_speaking)
    app.router.add_get(\"/api/admin/config\", admin_config)
""",
        """    app.router.add_post(\"/is_speaking\", is_speaking)
    app.router.add_post(\"/close_session\", close_session)
    app.router.add_get(\"/api/admin/config\", admin_config)
""",
    )
    return changed


def install_cosyvoice_client(root: Path, source: Path | None) -> bool:
    if source is None:
        return False
    source = source.resolve()
    if not source.is_file():
        raise RuntimeError(f"CosyVoice client template was not found: {source}")
    destination = root / "tts/cosyvoice.py"
    if destination.read_bytes() == source.read_bytes():
        return False
    shutil.copyfile(source, destination)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--cosyvoice-client", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / "app.py").is_file():
        raise SystemExit(f"not a LiveTalking checkout: {root}")
    changed = []
    for name, operation in (
        ("base_avatar", patch_base_avatar),
        ("genavatar", patch_genavatar),
        ("musetalk_blending", patch_musetalk_blending),
        ("rtc_manager", patch_rtc_manager),
        ("routes", patch_routes),
        ("cosyvoice_client", lambda target: install_cosyvoice_client(target, args.cosyvoice_client)),
    ):
        if operation(root):
            changed.append(name)
    print("patched=" + (",".join(changed) if changed else "none"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
