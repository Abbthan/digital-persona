import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, verifyPassword } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { deletePersonaMedia } from "@/back_end/services/storage";
import { deleteAllRagData } from "@/back_end/services/persona-rag";
import { deletePersonaGpuFiles } from "@/back_end/services/livetalking";

export type DeletePersonaResponseBody = { ok: true } | { ok: false; error: string };

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<DeletePersonaResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const discardDraft = body?.discardDraft === true;

  const { id: personaId } = await params;
  try {
    const persona = await db.persona.findFirst({
      where: { id: personaId, userId: user.id },
      include: { assets: { select: { url: true } } },
    });
    if (!persona) {
      return NextResponse.json<DeletePersonaResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    // The upload wizard creates a temporary draft before there are files to
    // attach. Its explicit discard action may remove only that unfinished
    // draft without a password; every saved/active persona still requires the
    // current password confirmation below.
    if (!(discardDraft && persona.status === "draft")) {
      if (!password) {
        return NextResponse.json<DeletePersonaResponseBody>(
          { ok: false, error: "Enter your current password to delete this persona." },
          { status: 400 },
        );
      }
      const account = await db.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!account || !(await verifyPassword(password, account.passwordHash))) {
        return NextResponse.json<DeletePersonaResponseBody>(
          { ok: false, error: "Incorrect password." },
          { status: 403 },
        );
      }
    }

    // Database cascades delete the asset and message rows; remove the private
    // storage objects explicitly so deleting a persona also frees its media.
    // One bad R2 object (or a slow/unreachable GPU box, above) shouldn't be
    // able to block the whole persona from being deleted — best-effort,
    // logged, not fatal.
    await Promise.all(
      persona.assets.map((asset) =>
        deletePersonaMedia(asset.url).catch((error) => {
          console.error(`Couldn't delete R2 object ${asset.url} for persona ${persona.id}`, error);
        }),
      ),
    );
    await deleteAllRagData(persona.id);
    await deletePersonaGpuFiles(persona.id);
    await db.persona.delete({ where: { id: persona.id } });

    return NextResponse.json<DeletePersonaResponseBody>({ ok: true });
  } catch (error) {
    console.error("DELETE /api/personas/[id] failed", error);
    return NextResponse.json<DeletePersonaResponseBody>(
      { ok: false, error: "Couldn't delete this persona. Please try again." },
      { status: 500 },
    );
  }
}
