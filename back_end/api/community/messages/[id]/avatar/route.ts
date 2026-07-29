import { NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { getPrivateMediaObject } from "@/back_end/services/storage";

const RETENTION_MS = 24 * 60 * 60 * 1_000;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentUser().catch(() => null);
  if (!viewer?.emailVerified) return new NextResponse(null, { status: 401 });

  try {
    const { id } = await params;
    const message = await getDb().communityMessage.findFirst({
      where: { id, createdAt: { gte: new Date(Date.now() - RETENTION_MS) } },
      include: { user: { select: { profileImageUrl: true } } },
    });
    if (!message?.user.profileImageUrl) return new NextResponse(null, { status: 404 });
    const media = await getPrivateMediaObject(message.user.profileImageUrl);
    if (!media) return new NextResponse(null, { status: 404 });
    return new NextResponse(media.body, {
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/community/messages/[id]/avatar failed", error);
    return new NextResponse(null, { status: 500 });
  }
}
