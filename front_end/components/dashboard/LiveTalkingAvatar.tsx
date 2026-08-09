"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateLiveSessionResponseBody } from "@/back_end/api/personas/[id]/live-session/route";

// The actual WebRTC media (video/audio) connects browser-to-GPU-box
// directly once negotiated — Cloudflare Workers can't hold a stateful
// media session, so that part has to be direct. But the signaling calls
// that set it up (/offer, /human) go through this app's own HTTPS routes
// (live-session/offer, live-session/human) rather than fetch()ing
// LiveTalking's plain-HTTP box directly — browsers block that as mixed
// content from an HTTPS page. Those routes mint their own short-lived
// HMAC-signed token server-side; LiveTalking's app.py checks it since it
// has no auth of its own.
//
// live-session returns this persona's own trained MuseTalk avatar_id and
// CosyVoice voice reference when training has produced one (see
// back_end/services/persona-training.ts). The parent mounts this component
// only after both dedicated facial scans have produced a liveAvatarId, so a
// private conversation never falls back to the server's generic demo face.

// Never send LiveTalking an SDP containing only the GPU host's private
// candidate. Gather until the browser has a server-reflexive (direct) or
// relay candidate instead. TURN is a fallback, not a forced path: forcing
// every session through a Tencent relay both adds latency and makes one bad
// TURN listener a total connection failure.
const ICE_GATHERING_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 35_000;
const PUBLIC_STUN_SERVERS = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

type LiveTalkingAvatarProps = {
  personaId: string;
  /** Bumps whenever a new persona reply should be spoken aloud by the avatar. */
  latestReply: { id: string; content: string; liveSpeechQueued?: boolean } | null;
  /** Gives the parent the session as soon as signaling has created it. */
  onSessionReady?: (sessionId: string) => void;
  /** Lets the dashboard place the live stream in either its compact or chat-area layout. */
  className?: string;
};

export function LiveTalkingAvatar({ personaId, latestReply, onSessionReady, className }: LiveTalkingAvatarProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<{ sessionid: string } | null>(null);
  const spokenReplyIdsRef = useRef(new Set<string>());
  // The TURN relay intermittently fails the very first connection attempt
  // and succeeds immediately on a plain retry (observed in production: ICE
  // goes connecting → failed once, then connecting → connected on the next
  // try, no other change). One transparent auto-retry absorbs that without
  // making the visitor click "Retry" themselves; a second failure in a row
  // is treated as real and shown normally, so a genuinely broken network
  // doesn't retry forever. Reset on persona change or a manual retry click,
  // not on the auto-retry's own reconnect.
  const autoRetryUsedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let connected = false;
    // Reset for this connection attempt (personaId or a manual retry) — an
    // external-system sync, not derivable from render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("connecting");
    setError(null);

    function releaseSession(sessionId?: string) {
      const id = sessionId ?? sessionRef.current?.sessionid;
      if (!id) return;
      if (sessionRef.current?.sessionid === id) sessionRef.current = null;
      void fetch(`/api/personas/${personaId}/live-session/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionid: id }),
        keepalive: true,
      }).catch(() => {});
    }

    async function connect() {
      console.info("[live-avatar] connecting", { personaId, attempt: connectAttempt + 1 });
      const tokenResponse = await fetch(`/api/personas/${personaId}/live-session`, { method: "POST" });
      const tokenResult = (await tokenResponse.json()) as CreateLiveSessionResponseBody;
      if (cancelled) return;
      if (!tokenResult.ok) throw new Error(tokenResult.error);
      console.info("[live-avatar] session configuration received", {
        personaId,
        hasAvatar: Boolean(tokenResult.avatarId),
        hasVoiceReference: Boolean(tokenResult.refAudio),
        usesTurn: Boolean(tokenResult.turn),
      });

      // The GPU server has no directly reachable public IP on any interface
      // — host and STUN-reflexive candidates from it are guaranteed to
      // fail. Letting ICE work through those doomed higher-priority pairs
      // before it ever got to the one viable relay-relay pair was consuming
      // the whole connection timeout. Forcing relay-only once a TURN relay
      // is configured skips straight to it. (`iceTransportPolicy: relay`
      // previously caused hard, guaranteed failures — but that was while
      // the configured TURN listener itself was unreachable; it's a real
      // externally-verified relay now, so the failure mode this avoided no
      // longer applies.) With no TURN configured at all, keep the old
      // STUN-only/direct behavior — relay-only with zero relay servers
      // would leave zero viable candidates.
      const iceServers: RTCIceServer[] = tokenResult.turn
        ? [{
          urls: tokenResult.turn.urls,
          username: tokenResult.turn.username,
          credential: tokenResult.turn.credential,
        }]
        : [{ urls: PUBLIC_STUN_SERVERS }];
      const pc = new RTCPeerConnection({
        iceServers,
        ...(tokenResult.turn ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {}),
      });
      pcRef.current = pc;
      pc.addEventListener("icecandidate", (event) => {
        // Candidate metadata is enough to diagnose TURN/STUN routing without
        // writing a visitor's private IP address into their browser console.
        if (event.candidate) {
          console.info("[live-avatar] ICE candidate gathered", {
            personaId,
            type: event.candidate.type,
            protocol: event.candidate.protocol,
          });
        } else {
          console.info("[live-avatar] ICE gathering completed", { personaId });
        }
      });
      pc.addEventListener("iceconnectionstatechange", () => {
        console.info("[live-avatar] ICE state", { personaId, state: pc.iceConnectionState });
      });
      pc.addEventListener("icecandidateerror", (event) => {
        // A failed optional STUN/TURN probe is not itself a connection error:
        // the browser may still select another direct or relay candidate.
        // Keep this as a warning so a recoverable fallback does not look like
        // a fatal application error in the console.
        console.warn("[live-avatar] ICE candidate probe failed", {
          personaId,
          errorCode: event.errorCode,
          url: event.url,
        });
      });
      pc.addEventListener("track", (event) => {
        console.info("[live-avatar] media track received", { personaId, kind: event.track.kind });
        if (event.track.kind === "video" && videoRef.current) videoRef.current.srcObject = event.streams[0];
        if (event.track.kind === "audio" && audioRef.current) audioRef.current.srcObject = event.streams[0];
      });
      // The SDP exchange succeeding only means signaling worked — the actual
      // media path (ICE/DTLS) can still fail afterward (e.g. no viable
      // route between the two networks), which used to leave the UI stuck
      // showing "connected" over a blank video with no indication anything
      // was wrong. This is the real signal to key off instead.
      pc.addEventListener("connectionstatechange", () => {
        if (cancelled) return;
        if (pc.connectionState === "connected") {
          connected = true;
          console.info("[live-avatar] connected", { personaId });
          setStatus("connected");
        } else if (pc.connectionState === "failed") {
          connected = false;
          releaseSession();
          if (!autoRetryUsedRef.current) {
            autoRetryUsedRef.current = true;
            console.warn("[live-avatar] peer connection failed, auto-retrying once", { personaId });
            setConnectAttempt((current) => current + 1);
            return;
          }
          console.error("[live-avatar] peer connection failed", { personaId });
          setStatus("error");
          setError("Lost the connection to the avatar server.");
        }
      });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      const offer = await pc.createOffer();
      // Register before setLocalDescription starts gathering. On some
      // browsers a local TURN allocation can produce its first candidate
      // before the awaited call yields back to this function.
      const iceReady = waitForIceGathering(pc, ICE_GATHERING_TIMEOUT_MS);
      await pc.setLocalDescription(offer);
      const hasIceCandidate = await iceReady;
      if (cancelled) return;
      if (!hasIceCandidate || !pc.localDescription?.sdp.includes("\na=candidate:")) {
        throw new Error("Couldn't establish a direct or relay media path. Please retry.");
      }

      const offerResponse = await fetch(`/api/personas/${personaId}/live-session/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
          ...(tokenResult.avatarId ? { avatar: tokenResult.avatarId } : {}),
          ...(tokenResult.refAudio ? { refaudio: tokenResult.refAudio } : {}),
          ...(tokenResult.refText ? { reftext: tokenResult.refText } : {}),
        }),
      });
      if (!offerResponse.ok) throw new Error(`Avatar server returned ${offerResponse.status}.`);
      const answer = (await offerResponse.json()) as
        | { sdp: string; type: RTCSdpType; sessionid: string }
        | { code: number; msg: string };
      // A 2xx status isn't itself proof of a real SDP answer — this
      // endpoint has returned success-status error bodies before (e.g. a
      // session-limit rejection with no sdp field at all), which otherwise
      // surfaces only as setRemoteDescription's opaque "Failed to parse
      // SessionDescription" instead of a clear, actionable message.
      if (!("sdp" in answer) || !answer.sdp) {
        throw new Error("msg" in answer && answer.msg ? answer.msg : "Avatar server sent an invalid response.");
      }
      if (cancelled) {
        pc.close();
        releaseSession(answer.sessionid);
        return;
      }
      await pc.setRemoteDescription(answer);
      sessionRef.current = { sessionid: answer.sessionid };
      console.info("[live-avatar] signaling completed", { personaId, sessionId: answer.sessionid });
      onSessionReady?.(answer.sessionid);
      // `custom_config` on the offer registers action type 1 with this
      // persona's own source frames. Selecting it explicitly matters on
      // deployments whose renderer otherwise stays on the static default
      // no-speech frame after a session is established.
      if (tokenResult.avatarId) {
        fetch(`/api/personas/${personaId}/live-session/idle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionid: answer.sessionid, audiotype: 1 }),
        }).catch(() => {
          // Speech/video remains usable even if an older GPU deployment does
          // not expose the optional idle-action endpoint yet.
        });
      }
      // Signaling is done; connectionstatechange above handles the actual
      // "connected" transition (and any later failure) from here.
    }

    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !connected) {
        cancelled = true;
        pcRef.current?.close();
        releaseSession();
        setStatus("error");
        setError("Couldn't reach the avatar server in time.");
      }
    }, CONNECT_TIMEOUT_MS);

    connect().catch((connectError) => {
      if (cancelled) return;
      console.error("[live-avatar] connection error", { personaId, error: connectError });
      setStatus("error");
      setError(connectError instanceof Error ? connectError.message : "Couldn't connect to the avatar server.");
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      pcRef.current?.close();
      pcRef.current = null;
      releaseSession();
    };
  }, [personaId, connectAttempt, onSessionReady]);

  // Only the automatic single retry above should be silent — a manual
  // retry click means the auto-retry already happened and failed again (or
  // this is a fresh problem), so it should get its own auto-retry chance
  // too rather than being permanently spent from one earlier failure.
  useEffect(() => {
    autoRetryUsedRef.current = false;
  }, [personaId]);

  const retry = useCallback(() => {
    autoRetryUsedRef.current = false;
    setConnectAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (status !== "connected" || !session || !latestReply) return;
    if (spokenReplyIdsRef.current.has(latestReply.id)) return;
    spokenReplyIdsRef.current.add(latestReply.id);

    // The message endpoint now dispatches speech server-to-server in the
    // background when it was given this session id. Retain this request only
    // for messages sent while the WebRTC session was still connecting.
    if (latestReply.liveSpeechQueued) return;

    fetch(`/api/personas/${personaId}/live-session/human`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionid: session.sessionid,
        utteranceId: latestReply.id,
        text: latestReply.content,
        type: "echo",
      }),
    }).catch(() => {
      // Non-fatal — the reply is already shown as a text bubble either way.
    });
  }, [status, latestReply, personaId]);

  return (
    <div className={`relative flex w-full flex-shrink-0 items-center justify-center overflow-hidden bg-surface-tile-1 ${className ?? "h-48 border-b border-hairline"}`}>
      {/* Audio is rendered by the dedicated audio element below. Keeping the
          video element muted prevents the same WebRTC audio track from being
          played twice with a slight scheduling offset (audible as echo and
          choppiness). */}
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      <audio ref={audioRef} autoPlay />
      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-xs bg-surface-tile-1">
          <p className="font-text text-caption text-body-muted">
            {status === "error" ? error ?? "Connection failed." : "Connecting…"}
          </p>
          {status === "error" && (
            <button
              type="button"
              onClick={retry}
              className="font-text text-caption-strong text-primary transition-transform duration-150 ease-out active:scale-95"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function waitForIceGathering(pc: RTCPeerConnection, maxWaitMs: number): Promise<boolean> {
  // A host candidate is normally a private LAN/container address and cannot
  // serve a visitor on the public Internet. For non-trickle LiveTalking SDP,
  // wait for either a STUN server-reflexive or TURN relay candidate to be
  // embedded before forwarding the offer.
  let hasRoutableCandidate = false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (hasCandidate: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidate", candidateReady);
      resolve(hasCandidate);
    };
    function check() {
      if (pc.iceGatheringState === "complete") {
        finish(hasRoutableCandidate);
      }
    }
    function candidateReady(event: RTCPeerConnectionIceEvent) {
      const candidateType = event.candidate?.type;
      if (candidateType === "srflx" || candidateType === "relay") {
        hasRoutableCandidate = true;
        finish(true);
      }
    }
    const timeoutId = window.setTimeout(
      () => finish(hasRoutableCandidate),
      maxWaitMs,
    );
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", candidateReady);
  });
}
