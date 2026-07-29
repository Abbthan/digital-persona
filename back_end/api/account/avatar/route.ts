import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getPrivateMediaObject } from "@/back_end/services/storage";

export type GetAvatarResponseBody = { url: string | null };

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const wantsContent = request.nextUrl.searchParams.get("content") === "1";
    if (!user?.profileImageUrl) {
      if (wantsContent) return new NextResponse(null, { status: 404 });
      return NextResponse.json<GetAvatarResponseBody>({ url: null });
    }
    if (!wantsContent) {
      // A same-origin, authenticated Worker endpoint serves the R2 object;
      // the database only ever exposes the opaque object key.
      return NextResponse.json<GetAvatarResponseBody>({
        url: `/api/account/avatar?content=1&v=${encodeURIComponent(user.profileImageUrl)}`,
      });
    }
    const media = await getPrivateMediaObject(user.profileImageUrl);
    if (!media) return new NextResponse(null, { status: 404 });
    return new NextResponse(media.body, {
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": media.cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/account/avatar failed", error);
    return NextResponse.json<GetAvatarResponseBody>({ url: null });
  }
}
