#!/usr/bin/env python3
"""Exercise the localhost ECHO gateway with a real WebRTC media session.

This diagnostic intentionally stays on the GPU host. It proves model loading,
authenticated signalling, idle video, CosyVoice dispatch, RTP audio/video, and
explicit session cleanup without claiming that public TURN/tunnel routing is
working.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

import aiohttp
import numpy as np
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription


def base64url(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def session_token(secret: str, persona_id: str) -> str:
    payload = base64url(
        json.dumps(
            {"uid": "local-smoke-test", "pid": persona_id, "exp": int(time.time()) + 600},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signature = base64url(hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def load_environment(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip("'\"")
    return values


async def wait_for(predicate, timeout: float, message: str) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError(message)
        await asyncio.sleep(0.05)


def selected_candidate_types(peer: RTCPeerConnection) -> list[str]:
    """Return only ICE candidate kinds, never private/public addresses."""
    selected: set[str] = set()
    for transceiver in peer.getTransceivers():
        dtls_transport = transceiver.receiver.transport
        if dtls_transport is None:
            continue
        ice_connection = getattr(dtls_transport.transport, "_connection", None)
        for pair in getattr(ice_connection, "_nominated", {}).values():
            selected.add(f"{pair.local_candidate.type}->{pair.remote_candidate.type}")
    return sorted(selected)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default="http://127.0.0.1:8010")
    parser.add_argument("--persona-id", default="cmsjqcvp60002psp73uk39ks9")
    parser.add_argument("--secret-file", type=Path, default=Path("/home/user/echo/secrets/livetalking.env"))
    parser.add_argument("--idle-seconds", type=float, default=3.0)
    parser.add_argument("--speech-timeout", type=float, default=35.0)
    parser.add_argument(
        "--utterance",
        default="This is an English voice test. 你好，这是中文语音测试。",
    )
    args = parser.parse_args()

    environment = load_environment(args.secret_file)
    secret = environment.get("LIVETALKING_SESSION_SECRET", "")
    if not secret:
        raise RuntimeError(f"LIVETALKING_SESSION_SECRET was not found in {args.secret_file}")
    token = session_token(secret, args.persona_id)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    ice_servers = [RTCIceServer(urls="stun:stun.cloudflare.com:3478")]
    turn_url = environment.get("TURN_SERVER_URL", "")
    turn_username = environment.get("TURN_USERNAME", "")
    turn_credential = environment.get("TURN_CREDENTIAL", "")
    if turn_url and turn_username and turn_credential:
        ice_servers.append(
            RTCIceServer(
                urls=[url.strip() for url in turn_url.split(",") if url.strip()],
                username=turn_username,
                credential=turn_credential,
            )
        )
    peer = RTCPeerConnection(configuration=RTCConfiguration(iceServers=ice_servers))
    peer.addTransceiver("video", direction="recvonly")
    peer.addTransceiver("audio", direction="recvonly")

    tracks: dict[str, object] = {}
    video_frames = 0
    idle_video_diffs: list[float] = []
    speaking_video_diffs: list[float] = []
    audio_peak = 0
    speaking = False
    previous_video: np.ndarray | None = None
    stop = asyncio.Event()

    @peer.on("track")
    def on_track(track) -> None:
        tracks[track.kind] = track

    async def consume_video() -> None:
        nonlocal video_frames, previous_video
        await wait_for(lambda: "video" in tracks, 20, "video track was not negotiated")
        track = tracks["video"]
        while not stop.is_set():
            frame = await asyncio.wait_for(track.recv(), timeout=10)
            pixels = frame.to_ndarray(format="rgb24")
            video_frames += 1
            if previous_video is not None:
                difference = float(np.mean(np.abs(pixels.astype(np.int16) - previous_video.astype(np.int16))))
                (speaking_video_diffs if speaking else idle_video_diffs).append(difference)
            previous_video = pixels

    async def consume_audio() -> None:
        nonlocal audio_peak
        await wait_for(lambda: "audio" in tracks, 20, "audio track was not negotiated")
        track = tracks["audio"]
        while not stop.is_set():
            frame = await asyncio.wait_for(track.recv(), timeout=10)
            if speaking:
                samples = frame.to_ndarray()
                if samples.size:
                    audio_peak = max(audio_peak, int(np.max(np.abs(samples.astype(np.int32)))))

    session_id = ""
    consumers: list[asyncio.Task] = []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as http:
        try:
            await peer.setLocalDescription(await peer.createOffer())
            await wait_for(lambda: peer.iceGatheringState == "complete", 15, "local ICE gathering timed out")
            payload = {
                "sdp": peer.localDescription.sdp,
                "type": peer.localDescription.type,
                "avatar": f"persona_{args.persona_id}",
                # Match personaIdleActionConfig() in back_end/services/livetalking.ts.
                # LiveTalking parses this field with json.loads and expects a list.
                "custom_config": json.dumps(
                    [
                        {
                            "audiotype": 1,
                            "imgpath": f"data/avatars/persona_{args.persona_id}/idle_imgs",
                        }
                    ],
                    separators=(",", ":"),
                ),
                "refaudio": f"data/voice_refs/{args.persona_id}.wav",
                "reftext": "Reference voice for ECHO.",
            }
            async with http.post(f"{args.gateway}/offer", headers=headers, json=payload) as response:
                body = await response.text()
                if response.status != 200:
                    raise RuntimeError(f"offer returned HTTP {response.status}: {body[:500]}")
                answer = json.loads(body)
            if not isinstance(answer.get("sdp"), str) or answer.get("type") != "answer":
                raise RuntimeError(f"offer returned an invalid answer: {answer}")
            session_id = str(answer.get("sessionid") or "")
            if not session_id:
                raise RuntimeError("offer answer did not include a sessionid")
            await peer.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
            await wait_for(lambda: peer.connectionState == "connected", 25, f"peer failed to connect ({peer.connectionState})")

            consumers = [asyncio.create_task(consume_video()), asyncio.create_task(consume_audio())]
            async with http.post(
                f"{args.gateway}/set_audiotype", headers=headers, json={"sessionid": session_id, "audiotype": 1}
            ) as response:
                if response.status != 200:
                    raise RuntimeError(f"idle action returned HTTP {response.status}: {await response.text()}")
            await asyncio.sleep(args.idle_seconds)

            speaking = True
            utterance = args.utterance
            async with http.post(
                f"{args.gateway}/human",
                headers=headers,
                json={"sessionid": session_id, "utterance_id": f"smoke-{int(time.time())}", "text": utterance, "type": "echo"},
            ) as response:
                if response.status != 200:
                    raise RuntimeError(f"speech dispatch returned HTTP {response.status}: {await response.text()}")
            await wait_for(lambda: audio_peak > 100, args.speech_timeout, "no non-silent synthesized audio arrived")
            await asyncio.sleep(2)

            if video_frames < 20:
                raise RuntimeError(f"too few video frames arrived: {video_frames}")
            result = {
                "ok": True,
                "session_id": session_id,
                "connection_state": peer.connectionState,
                "video_frames": video_frames,
                "idle_mean_frame_difference": round(float(np.mean(idle_video_diffs or [0])), 4),
                "speaking_mean_frame_difference": round(float(np.mean(speaking_video_diffs or [0])), 4),
                "audio_peak": audio_peak,
                "selected_candidate_types": selected_candidate_types(peer),
            }
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            stop.set()
            for task in consumers:
                task.cancel()
            if consumers:
                await asyncio.gather(*consumers, return_exceptions=True)
            if session_id:
                try:
                    async with http.post(
                        f"{args.gateway}/close_session",
                        headers=headers,
                        json={"sessionid": session_id},
                    ) as response:
                        await response.read()
                except Exception:
                    pass
            await peer.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
