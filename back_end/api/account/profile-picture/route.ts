import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getSession } from "@/back_end/services/session";
import { deletePersonaMedia, uploadProfilePicture } from "@/back_end/services/storage";

export type UpdateProfilePictureResponseBody = { ok: true } | { ok: false; error: string };

const MAX_SIZE_BYTES = 1 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export async function POST(request: NextRequest) {
  const db = getDb();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json<UpdateProfilePictureResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json<UpdateProfilePictureResponseBody>(
      { ok: false, error: "Choose a PNG, JPG, or JPEG image." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json<UpdateProfilePictureResponseBody>(
      { ok: false, error: "Profile picture must be 1MB or smaller." },
      { status: 400 },
    );
  }

  try {
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json<UpdateProfilePictureResponseBody>(
        { ok: false, error: "Account not found." },
        { status: 404 },
      );
    }

    const { path } = await uploadProfilePicture(user.id, file);

    await db.user.update({ where: { id: user.id }, data: { profileImageUrl: path } });

    // Best-effort cleanup of the old picture — not worth failing the request over.
    if (user.profileImageUrl) {
      deletePersonaMedia(user.profileImageUrl).catch(() => {});
    }

    return NextResponse.json<UpdateProfilePictureResponseBody>({ ok: true });
  } catch (error) {
    console.error("POST /api/account/profile-picture failed", error);
    return NextResponse.json<UpdateProfilePictureResponseBody>(
      { ok: false, error: "Couldn't upload — the database or storage isn't reachable yet." },
      { status: 500 },
    );
  }
}
