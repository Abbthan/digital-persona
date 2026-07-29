import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { incrementPlatformMetrics } from "@/back_end/services/metrics";
import { maskInappropriateLanguage } from "@/back_end/services/moderation";

const MESSAGE_MAX_LENGTH = 200;
const MESSAGE_MAX_LINES = 10;
const SEND_COOLDOWN_MS = 15_000;
const RETENTION_MS = 24 * 60 * 60 * 1_000;

export type CommunityMessageDTO = {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  avatarUrl: string | null;
};

export type GetCommunityMessagesResponse =
  | { ok: true; messages: CommunityMessageDTO[] }
  | { ok: false; error: string };

export type SendCommunityMessageResponse =
  | { ok: true; message: CommunityMessageDTO }
  | { ok: false; error: string; retryAfterSeconds?: number };

function cutoffDate() {
  return new Date(Date.now() - RETENTION_MS);
}

function toDto(message: {
  id: string;
  userId: string;
  content: string;
  createdAt: Date;
  user: { username: string; profileImageUrl: string | null };
}): CommunityMessageDTO {
  return {
    id: message.id,
    userId: message.userId,
    username: message.user.username,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    // Avatar content remains private in R2. This endpoint is only reachable
    // by signed-in community members and only for a message still inside the
    // 24-hour community window.
    avatarUrl: message.user.profileImageUrl ? `/api/community/messages/${message.id}/avatar` : null,
  };
}

async function requireUser() {
  const user = await getCurrentUser().catch(() => null);
  return user?.emailVerified ? user : null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json<GetCommunityMessagesResponse>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  try {
    const db = getDb();
    const cutoff = cutoffDate();
    await db.communityMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const messages = await db.communityMessage.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { username: true, profileImageUrl: true } } },
    });
    return NextResponse.json<GetCommunityMessagesResponse>(
      { ok: true, messages: messages.map(toDto) },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("GET /api/community/messages failed", error);
    return NextResponse.json<GetCommunityMessagesResponse>(
      { ok: false, error: "Couldn't load community messages. Please try again shortly." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json<SendCommunityMessageResponse>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? maskInappropriateLanguage(body.content.trim()) : "";
  if (!content) {
    return NextResponse.json<SendCommunityMessageResponse>(
      { ok: false, error: "Message can't be empty." },
      { status: 400 },
    );
  }
  if (content.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json<SendCommunityMessageResponse>(
      { ok: false, error: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (content.split(/\r?\n/).length > MESSAGE_MAX_LINES) {
    return NextResponse.json<SendCommunityMessageResponse>(
      { ok: false, error: `Messages are limited to ${MESSAGE_MAX_LINES} lines.` },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const now = new Date();
    const cutoff = cutoffDate();
    await db.communityMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const lastMessage = await db.communityMessage.findFirst({
      where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - SEND_COOLDOWN_MS) } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastMessage) {
      const retryAfterSeconds = Math.max(1, Math.ceil((lastMessage.createdAt.getTime() + SEND_COOLDOWN_MS - now.getTime()) / 1_000));
      return NextResponse.json<SendCommunityMessageResponse>(
        { ok: false, error: `Please wait ${retryAfterSeconds}s before sending another message.`, retryAfterSeconds },
        { status: 429 },
      );
    }

    const message = await db.communityMessage.create({
      data: { userId: user.id, content },
      include: { user: { select: { username: true, profileImageUrl: true } } },
    });
    await incrementPlatformMetrics({ messagesExchanged: 1 }).catch((error) => console.error("Community metric increment failed", error));
    return NextResponse.json<SendCommunityMessageResponse>({ ok: true, message: toDto(message) });
  } catch (error) {
    console.error("POST /api/community/messages failed", error);
    return NextResponse.json<SendCommunityMessageResponse>(
      { ok: false, error: "Couldn't send your message. Please try again." },
      { status: 500 },
    );
  }
}
