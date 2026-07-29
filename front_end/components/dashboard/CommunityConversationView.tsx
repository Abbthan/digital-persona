"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/front_end/components/ui";
import type { CommunityMessageDTO, GetCommunityMessagesResponse, SendCommunityMessageResponse } from "@/back_end/api/community/messages/route";

const POLL_INTERVAL_MS = 3_000;
const MESSAGE_LIMIT = 200;
const MESSAGE_LINE_LIMIT = 10;

type CommunityConversationViewProps = { currentUserId: string };

function initials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

function withinMessageLimits(value: string) {
  const firstTenLines = value.split(/\r?\n/).slice(0, MESSAGE_LINE_LIMIT).join("\n");
  return firstTenLines.slice(0, MESSAGE_LIMIT);
}

export function CommunityConversationView({ currentUserId }: CommunityConversationViewProps) {
  const [messages, setMessages] = useState<CommunityMessageDTO[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const previousMessageCount = useRef(0);

  useEffect(() => {
    let ignore = false;
    const load = () => {
      fetch("/api/community/messages", { cache: "no-store", credentials: "same-origin" })
        .then((response) => response.json())
        .then((result: GetCommunityMessagesResponse) => {
          if (ignore) return;
          if (result.ok) {
            setMessages(result.messages);
            setError(null);
          } else {
            setError(result.error);
          }
        })
        .catch(() => {
          if (!ignore) setError("Couldn't load community messages. Please try again shortly.");
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    };
    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearInterval(interval);
  }, [cooldown]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const hasNewMessages = messages.length > previousMessageCount.current;
    if (list && (previousMessageCount.current === 0 || (hasNewMessages && shouldStickToBottom.current))) {
      list.scrollTop = list.scrollHeight;
    }
    previousMessageCount.current = messages.length;
  }, [messages]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    shouldStickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending || cooldown > 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/community/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await response.json() as SendCommunityMessageResponse;
      if (!result.ok) {
        setError(result.error);
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setInput("");
      setCooldown(15);
      shouldStickToBottom.current = true;
      setMessages((current) => [...current.filter((message) => message.id !== result.message.id), result.message]);
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-canvas" aria-label="Community discussion">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-lg py-sm">
        <div>
          <h1 className="font-display text-tagline text-ink">Community</h1>
          <p className="mt-xxs font-text text-caption text-ink-muted-48">Live discussion with the ECHO community. Messages disappear after 24 hours.</p>
        </div>
        <span className="font-text text-fine-print text-ink-muted-48">15s between messages</span>
      </header>

      <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-lg">
        {loading ? (
          <p className="font-text text-caption text-ink-muted-48">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="font-text text-caption text-ink-muted-48">No community messages yet. Start the conversation.</p>
        ) : (
          <div className="flex flex-col gap-md">
            {messages.map((message) => {
              const ownMessage = message.userId === currentUserId;
              return (
                <motion.article
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex items-end gap-xs ${ownMessage ? "flex-row-reverse" : "flex-row"}`}
                >
                  {message.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin community avatar response
                    <img src={message.avatarUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-chip-translucent font-text text-fine-print text-ink">
                      {initials(message.username)}
                    </div>
                  )}
                  <div className={`flex max-w-[76%] flex-col ${ownMessage ? "items-end" : "items-start"}`}>
                    <p className="mb-xxs px-xxs font-text text-fine-print text-ink-muted-48">
                      {message.username} · {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </p>
                    <div className={`rounded-lg px-sm py-xs font-text text-body ${ownMessage ? "frosted-primary-fill text-on-primary" : "bg-canvas-parchment text-ink"}`}>
                      {message.content}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-shrink-0 flex-col gap-xs border-t border-hairline p-sm">
        <textarea
          value={input}
          onChange={(event) => setInput(withinMessageLimits(event.target.value))}
          maxLength={MESSAGE_LIMIT}
          rows={2}
          placeholder="Write a message to the community"
          className="w-full resize-none rounded-md border border-hairline bg-canvas px-sm py-xs font-text text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
        />
        <div className="flex items-center justify-between gap-sm">
          <div className="min-w-0">
            {error ? <p role="alert" className="font-text text-caption text-red-500">{error}</p> : <p className="font-text text-fine-print text-ink-muted-48">{input.length}/{MESSAGE_LIMIT} · {input.split(/\r?\n/).length}/{MESSAGE_LINE_LIMIT} lines</p>}
          </div>
          <Button type="submit" variant="primary" disabled={sending || !input.trim() || cooldown > 0}>
            {cooldown > 0 ? `Send in ${cooldown}s` : sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
