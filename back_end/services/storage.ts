import { getCloudflareContext } from "@opennextjs/cloudflare";

type R2ObjectBody = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string; cacheControl?: string };
};

type R2BucketBinding = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
};

export type UploadedMedia = {
  /** Private R2 object key, persisted in Postgres rather than a public URL. */
  path: string;
};

export type PrivateMediaObject = {
  body: ReadableStream;
  contentType: string;
  cacheControl: string;
};

function getMediaBucket(): R2BucketBinding {
  try {
    const bucket = getCloudflareContext().env.PERSONA_MEDIA as unknown as R2BucketBinding | undefined;
    if (bucket) return bucket;
  } catch {
    // The binding is intentionally absent outside the Cloudflare runtime.
  }
  throw new Error("Cloudflare R2 media storage is not configured.");
}

function extensionOf(file: File): string {
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  return extension?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
}

function contentDisposition(fileName: string): string {
  // R2 stores private objects; this is metadata for the authenticated Worker
  // response only. Strip quotes/control characters from a user-provided name.
  const safeName = fileName.replace(/[\\"\r\n]/g, "_");
  return `inline; filename="${safeName}"`;
}

async function uploadFile(prefix: string, file: File): Promise<UploadedMedia> {
  const path = `${prefix}/${crypto.randomUUID()}.${extensionOf(file)}`;
  // Preserve the browser-provided file stream all the way into R2. This
  // avoids allocating a second whole-file ArrayBuffer in the Worker.
  await getMediaBucket().put(path, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      contentDisposition: contentDisposition(file.name),
      cacheControl: "private, max-age=3600",
    },
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
  return { path };
}

export function uploadPersonaMedia(personaId: string, file: File): Promise<UploadedMedia> {
  return uploadFile(personaId, file);
}

export function uploadProfilePicture(userId: string, file: File): Promise<UploadedMedia> {
  return uploadFile(`users/${userId}`, file);
}

export async function getPrivateMediaObject(path: string): Promise<PrivateMediaObject | null> {
  if (!path || path.includes("..") || path.startsWith("/")) return null;
  const object = await getMediaBucket().get(path);
  if (!object) return null;
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    cacheControl: object.httpMetadata?.cacheControl ?? "private, max-age=3600",
  };
}

export async function deletePersonaMedia(path: string): Promise<void> {
  if (!path || path.includes("..") || path.startsWith("/")) return;
  await getMediaBucket().delete(path);
}
