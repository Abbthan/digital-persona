"use client";

import { motion } from "motion/react";
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { hasPaidAccess } from "@/back_end/services/limits";
import { useModalController } from "@/front_end/state/modal-context";
import { useLocale } from "@/front_end/state/locale-context";
import { LiveTalkingAvatar } from "./LiveTalkingAvatar";
import type {
  ChatMessageDTO,
  GetMessagesResponseBody,
  SendMessageResponseBody,
} from "@/back_end/api/personas/[id]/messages/route";
import type { TranscribeResponseBody } from "@/back_end/api/personas/[id]/transcribe/route";

type PersonaConversationViewProps = {
  personaId: string;
  personaName: string;
};

type MicStatus = "off" | "listening" | "speaking" | "transcribing";

// Voice-activity detection tuning: a pause this long ends the current
// utterance and sends it for transcription; a blip shorter than this never
// counts as one (coughs, mic bumps, silence between words is much shorter).
const SPEECH_RMS_THRESHOLD = 0.03;
const PAUSE_MS = 1500;
const MIN_SPEECH_MS = 300;
const VAD_POLL_MS = 100;

function spokenReplyForLocale(content: string, personaName: string, locale: "en" | "zh") {
  if (locale !== "zh") return content;
  const prefix = `(${personaName} isn't connected to a real AI yet — this is a canned echo) You said: \"`;
  if (!content.startsWith(prefix) || !content.endsWith("\"")) return content;
  return `（${personaName} 尚未接入真实的 AI——这是预设回复。）你说：“${content.slice(prefix.length, -1)}”`;
}

function computeRms(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const normalized = (buffer[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

export function PersonaConversationView({
  personaId,
  personaName,
}: PersonaConversationViewProps) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const { openModal } = useModalController();
  const isPaid = hasPaidAccess(user?.subscription.status, user?.subscription.currentPeriodEnd);

  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [latestReply, setLatestReply] = useState<{ id: string; content: string; liveSpeechQueued?: boolean } | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const [liveVideoEnabled, setLiveVideoEnabled] = useState(true);
  const [chatPosition, setChatPosition] = useState<{ x: number; y: number } | null>(null);
  const [chatMinimized, setChatMinimized] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const speechStartAtRef = useRef(0);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const videoMode = isPaid && liveVideoEnabled;

  // Loading a persona's history is a canonical data-fetch effect. No need to
  // reset `loading` here — DashboardShell mounts this component with
  // key={persona.id}, so switching personas remounts it fresh (loading
  // already starts true via useState) instead of reusing this instance.
  useEffect(() => {
    let ignore = false;
    fetch(`/api/personas/${personaId}/messages`)
      .then((response) => response.json())
      .then((data: GetMessagesResponseBody) => {
        if (ignore) return;
        if (data.ok) setMessages(data.messages);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [personaId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(content: string) {
    if (!content.trim()) return;
    setSending(true);
    try {
      const response = await fetch(`/api/personas/${personaId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          // Supplying an established session lets the backend enqueue speech
          // without a second round trip through the browser.
          ...(videoMode && liveSessionId ? { liveSessionId } : {}),
          locale,
        }),
      });
      const result = (await response.json()) as SendMessageResponseBody;
      if (result.ok) {
        setMessages((current) => [...current, result.userMessage, result.replyMessage]);
        setLatestReply({
          id: result.replyMessage.id,
          content: spokenReplyForLocale(result.replyMessage.content, personaName, locale),
          liveSpeechQueued: result.liveSpeechQueued,
        });
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const content = input;
    setInput("");
    await sendMessage(content);
  }

  // Always-on mic: once toggled on, a VAD loop over the raw stream (not
  // MediaRecorder) watches volume to find utterance boundaries. Each time
  // speech starts, a MediaRecorder segment begins; once volume drops for
  // PAUSE_MS straight, that segment is cut and queued for transcription,
  // and the loop keeps listening for the next utterance without the user
  // touching the mic button again. Real transcript in, but the reply is
  // still the existing canned echo — no LLM wired up yet.
  function enqueueTranscription(blob: Blob, mimeType: string) {
    sendQueueRef.current = sendQueueRef.current.then(async () => {
      setMicStatus((current) => (current === "off" ? current : "transcribing"));
      try {
        const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
        const formData = new FormData();
        formData.append("audio", blob, `utterance.${extension}`);
        const response = await fetch(`/api/personas/${personaId}/transcribe`, {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as TranscribeResponseBody;
        if (result.ok && result.text.trim()) {
          await sendMessage(result.text.trim());
        }
      } finally {
        setMicStatus((current) => (current === "off" ? current : "listening"));
      }
    });
  }

  function startUtteranceRecording() {
    const stream = micStreamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - speechStartAtRef.current;
      if (durationMs >= MIN_SPEECH_MS && chunks.length > 0) {
        enqueueTranscription(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), recorder.mimeType);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
  }

  function stopListening() {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      // Mic is being switched off mid-utterance — discard the partial clip.
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    speakingRef.current = false;
    setMicStatus("off");
  }

  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.fftSize);
      speakingRef.current = false;
      setMicStatus("listening");

      vadTimerRef.current = setInterval(() => {
        const currentAnalyser = analyserRef.current;
        if (!currentAnalyser) return;
        const rms = computeRms(currentAnalyser, buffer);
        const now = Date.now();
        if (rms > SPEECH_RMS_THRESHOLD) {
          lastVoiceAtRef.current = now;
          if (!speakingRef.current) {
            speakingRef.current = true;
            speechStartAtRef.current = now;
            setMicStatus("speaking");
            startUtteranceRecording();
          }
        } else if (speakingRef.current && now - lastVoiceAtRef.current > PAUSE_MS) {
          speakingRef.current = false;
          setMicStatus("listening");
          recorderRef.current?.stop();
          recorderRef.current = null;
        }
      }, VAD_POLL_MS);
    } catch {
      // Permission denied — the mic button just stays inert.
      setMicStatus("off");
    }
  }

  function toggleVoiceInput() {
    if (micStatus === "off") {
      void startListening();
    } else {
      stopListening();
    }
  }

  useEffect(() => {
    return () => stopListening();
  }, []);

  function moveChatWindow(clientX: number, clientY: number) {
    const panel = chatPanelRef.current;
    const conversation = conversationRef.current;
    const offset = dragOffsetRef.current;
    if (!panel || !conversation || !offset) return;
    const margin = 8;
    const bounds = conversation.getBoundingClientRect();
    const maxX = Math.max(margin, conversation.clientWidth - panel.offsetWidth - margin);
    const maxY = Math.max(margin, conversation.clientHeight - panel.offsetHeight - margin);
    setChatPosition({
      x: Math.min(Math.max(margin, clientX - bounds.left - offset.x), maxX),
      y: Math.min(Math.max(margin, clientY - bounds.top - offset.y), maxY),
    });
  }

  function startChatDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const panel = chatPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragChat(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragOffsetRef.current) moveChatWindow(event.clientX, event.clientY);
  }

  function endChatDrag(event: ReactPointerEvent<HTMLDivElement>) {
    dragOffsetRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={conversationRef}
      className={videoMode
        ? "relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-hairline bg-surface-black"
        : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-canvas"}
    >
      {videoMode ? (
        <>
          <LiveTalkingAvatar
            personaId={personaId}
            latestReply={latestReply}
            onSessionReady={setLiveSessionId}
            className="absolute inset-0 h-full border-0"
          />
          <button
            type="button"
            onClick={() => setLiveVideoEnabled(false)}
            className="absolute bottom-2 left-2 z-10 rounded-pill border border-white/30 bg-black/45 px-sm py-xs font-text text-caption text-white backdrop-blur-md transition-transform duration-150 ease-out active:scale-95"
          >
            Turn video off
          </button>
        </>
      ) : isPaid ? (
        <div className="flex flex-shrink-0 items-center justify-between gap-xs border-b border-hairline bg-canvas-parchment px-lg py-sm">
          <p className="font-text text-caption text-ink-muted-80">Live video is off.</p>
          <Button variant="secondary" onClick={() => setLiveVideoEnabled(true)}>
            Turn video on
          </Button>
        </div>
      ) : (
        <div className="flex flex-shrink-0 flex-col items-center gap-xs border-b border-hairline bg-canvas-parchment px-lg py-sm text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="font-text text-caption text-ink-muted-80">
            Real-time voice and video conversation is a subscriber feature.
          </p>
          <Button variant="secondary" onClick={() => openModal("pricing")}>
            Upgrade
          </Button>
        </div>
      )}

      <div
        ref={chatPanelRef}
        className={videoMode
          ? `absolute right-2 top-2 z-20 flex flex-col overflow-hidden rounded-lg border border-white/20 bg-canvas/95 shadow-product backdrop-blur-xl transition-[width,height] duration-200 ease-out ${chatMinimized
            ? "h-11 w-[min(17rem,calc(100%-1rem))]"
            : "h-[min(36rem,calc(100%-1rem))] w-[min(26rem,calc(100%-1rem))]"
          }`
          : "flex min-h-0 flex-1 flex-col overflow-hidden"}
        style={videoMode && chatPosition
          ? { left: `${chatPosition.x}px`, top: `${chatPosition.y}px`, right: "auto" }
          : undefined}
      >
        {videoMode && (
          <div
            role="presentation"
            aria-label="Drag chat window"
            onPointerDown={startChatDrag}
            onPointerMove={dragChat}
            onPointerUp={endChatDrag}
            onPointerCancel={endChatDrag}
            className={`flex flex-shrink-0 touch-none items-center justify-between bg-canvas-parchment/80 px-sm py-xs select-none ${
              chatMinimized ? "h-full" : "border-b border-hairline"
            }`}
          >
            <div className="flex min-w-0 items-center gap-xs">
              <p className="truncate font-text text-caption-strong text-ink">{personaName}</p>
              {!chatMinimized && <span className="font-text text-fine-print text-ink-muted-48">⋮⋮</span>}
            </div>
            <button
              type="button"
              aria-label={chatMinimized ? "Expand chat" : "Minimize chat"}
              aria-expanded={!chatMinimized}
              title={chatMinimized ? "Expand chat" : "Minimize chat"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setChatMinimized((current) => !current)}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-text text-caption-strong text-ink-muted-80 transition-colors hover:bg-surface-chip-translucent active:scale-95"
            >
              {chatMinimized ? "⌃" : "−"}
            </button>
          </div>
        )}

        {(!videoMode || !chatMinimized) && <>
        <div className="flex min-h-0 flex-1 flex-col gap-xs overflow-y-auto overscroll-contain p-lg">
        {loading ? (
          <p className="font-text text-caption text-ink-muted-48">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="font-text text-caption text-ink-muted-48">Say hello to {personaName}.</p>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-sm py-xs font-text text-body ${
                    isUser ? "bg-primary text-on-primary" : "bg-canvas-parchment text-ink"
                  }`}
                >
                  <p>{message.content}</p>
                  <p
                    className={`mt-xxs font-text text-fine-print ${
                      isUser ? "text-white/70" : "text-ink-muted-48"
                    }`}
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={bottomRef} />
        </div>

        {micStatus !== "off" && (
          <p className="flex-shrink-0 px-lg pb-xxs font-text text-fine-print text-ink-muted-48">
            {micStatus === "speaking"
              ? "Hearing you…"
              : micStatus === "transcribing"
                ? "Transcribing…"
                : "Listening — pause when you're done talking."}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex flex-shrink-0 items-center gap-xs border-t border-hairline p-sm"
        >
          <button
            type="button"
            onClick={toggleVoiceInput}
            aria-label="Voice input"
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-95 ${
              micStatus === "speaking"
                ? "frosted-primary-fill animate-pulse text-on-primary"
                : micStatus === "transcribing"
                  ? "frosted-primary-fill text-on-primary"
                  : micStatus === "listening"
                    ? "bg-surface-chip-translucent text-primary ring-2 ring-primary-focus"
                    : "bg-surface-chip-translucent text-ink"
            }`}
          >
            🎙
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`Message ${personaName}`}
            className="flex-1 rounded-pill border border-hairline bg-canvas px-lg py-sm font-text text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          />
          <Button type="submit" variant="primary" disabled={sending || !input.trim()}>
            Send
          </Button>
        </form>
        </>}
      </div>
    </div>
  );
}
