import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/back_end/services/auth";
import { getDb } from "@/back_end/services/db";
import { captureSupportedProfile, formatLearnedNotes, parseSupportedProfileUrl } from "@/back_end/services/social-profile";
import { deletePersonaMedia, uploadPersonaMedia } from "@/back_end/services/storage";
import { ingestDocument } from "@/back_end/services/persona-rag";

export type ImportSocialResponseBody =
  | { ok: true; asset: { id: string; name: string } }
  | { ok: false; error: string };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.emailVerified) {
    return NextResponse.json<ImportSocialResponseBody>(
      { ok: false, error: "You're not logged in." },
      { status: 401 },
    );
  }

  const { id: personaId } = await params;
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  const target = parseSupportedProfileUrl(url);
  if (!target) {
    return NextResponse.json<ImportSocialResponseBody>(
      { ok: false, error: "Enter a public Instagram, Facebook, X/Twitter, YouTube, or Xiaohongshu profile URL." },
      { status: 400 },
    );
  }

  let uploadedPath: string | null = null;
  try {
    const persona = await db.persona.findFirst({ where: { id: personaId, userId: user.id } });
    if (!persona) {
      return NextResponse.json<ImportSocialResponseBody>(
        { ok: false, error: "Persona not found." },
        { status: 404 },
      );
    }

    // One file per social page, holding a compacted write-up of whatever was
    // publicly learnable from it — see formatLearnedNotes' doc comment for
    // exactly what that does and doesn't cover.
    const snapshot = await captureSupportedProfile(target);
    const displayName = `${snapshot.platform}.${snapshot.accountName}`;
    const notes = formatLearnedNotes(snapshot);
    const file = new File([notes], `${displayName}.txt`, { type: "text/plain" });
    const { path } = await uploadPersonaMedia(personaId, file);
    uploadedPath = path;

    const asset = await db.personaAsset.create({
      data: {
        personaId,
        type: "social_link",
        url: path,
        metadata: {
          originalName: displayName,
          size: file.size,
          mimeType: file.type,
          platform: snapshot.platform,
          accountName: snapshot.accountName,
          sourceUrl: snapshot.sourceUrl,
          capturedAt: snapshot.fetchedAt,
          metadataAvailable: snapshot.metadataAvailable,
        },
      },
      select: { id: true },
    });

    // The compact public-profile note is a private text asset, so index it
    // exactly like a document. It is still scoped to this persona by the
    // signed GPU request and never becomes public search data.
    after(async () => {
      try {
        await ingestDocument(personaId, asset.id, `${displayName}.txt`);
      } catch (ragError) {
        console.error("Background social-profile memory ingestion failed", ragError);
      }
    });

    return NextResponse.json<ImportSocialResponseBody>({ ok: true, asset: { id: asset.id, name: displayName } });
  } catch (error) {
    if (uploadedPath) deletePersonaMedia(uploadedPath).catch(() => {});
    console.error("POST /api/personas/[id]/import-social failed", error);
    return NextResponse.json<ImportSocialResponseBody>(
      { ok: false, error: "Couldn't read that public profile. Make sure the link is public and try again." },
      { status: 500 },
    );
  }
}
