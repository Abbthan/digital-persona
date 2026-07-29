import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/back_end/services/db";
import { getPrivateMediaObject } from "@/back_end/services/storage";

type ServiceTokenPayload = { uid?: unknown; pid?: unknown; exp?: unknown };

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const paddingLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * The A800 already shares the LiveTalking HMAC secret. It uses a token minted
 * by this Worker to pull one exact private persona asset; user cookies are
 * intentionally not involved in this server-to-server path.
 */
async function isAuthorizedGpuPull(request: NextRequest, personaId: string): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const secret = process.env.LIVETALKING_SESSION_SECRET;
  if (!secret) return false;

  try {
    const [payloadB64, signatureB64] = authorization.slice("Bearer ".length).split(".", 2);
    if (!payloadB64 || !signatureB64) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signatureB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!validSignature) return false;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64))) as ServiceTokenPayload;
    return payload.uid === "system" && payload.pid === personaId && typeof payload.exp === "number" && payload.exp >= Date.now() / 1_000;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ personaId: string; assetId: string }> },
) {
  const { personaId, assetId } = await params;
  if (!await isAuthorizedGpuPull(request, personaId)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const asset = await getDb().personaAsset.findFirst({
      where: { id: assetId, personaId },
      select: { url: true },
    });
    if (!asset) return NextResponse.json({ ok: false, error: "Asset not found." }, { status: 404 });

    const object = await getPrivateMediaObject(asset.url);
    if (!object) return NextResponse.json({ ok: false, error: "Media not found." }, { status: 404 });

    return new NextResponse(object.body, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/internal/persona-media failed", error);
    return NextResponse.json({ ok: false, error: "Couldn't retrieve media." }, { status: 500 });
  }
}
