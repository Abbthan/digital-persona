type SupportedPlatform = "instagram" | "facebook" | "twitter" | "youtube" | "xiaohongshu";

type ProfileTarget = {
  platform: SupportedPlatform;
  accountName: string;
  url: URL;
};

class ProfileCaptureError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProfileCaptureError";
  }
}

const HOSTS: Record<SupportedPlatform, string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  twitter: ["twitter.com", "www.twitter.com", "x.com", "www.x.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com"],
  xiaohongshu: ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"],
};

const RESERVED_PATHS: Record<SupportedPlatform, Set<string>> = {
  instagram: new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]),
  facebook: new Set(["about", "events", "groups", "help", "marketplace", "pages", "watch"]),
  twitter: new Set(["explore", "home", "i", "intent", "search", "settings"]),
  youtube: new Set(["feed", "results", "shorts", "watch"]),
  xiaohongshu: new Set(["explore", "login", "search"]),
};

function platformForHost(hostname: string): SupportedPlatform | null {
  return (Object.keys(HOSTS) as SupportedPlatform[]).find((platform) => HOSTS[platform].includes(hostname)) ?? null;
}

function accountNameFor(platform: SupportedPlatform, pathParts: string[]): string | null {
  const firstPart = pathParts[0]?.replace(/^@/, "") ?? "";
  if (!firstPart || RESERVED_PATHS[platform].has(firstPart.toLowerCase())) return null;

  if (platform === "youtube" && firstPart === "channel") return pathParts[1] ?? null;
  if (platform === "xiaohongshu" && firstPart === "user") return pathParts.at(-1) ?? null;
  return firstPart;
}

function safeAccountName(value: string) {
  const normalized = value.normalize("NFKC").trim().replace(/[^\p{L}\p{N}_.-]+/gu, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 80) || null;
}

export function parseSupportedProfileUrl(value: string): ProfileTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return null;

  const platform = platformForHost(url.hostname.toLowerCase());
  if (!platform) return null;
  const accountName = safeAccountName(accountNameFor(platform, url.pathname.split("/").filter(Boolean)) ?? "");
  return accountName ? { platform, accountName, url } : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function metaValue(html: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return null;
}

function pageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/\s+/g, " ").trim()) : null;
}

export type SocialProfileSnapshot = {
  sourceUrl: string;
  fetchedAt: string;
  platform: SupportedPlatform;
  accountName: string;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  siteName: string | null;
  hasProfileImage: boolean;
  metadataAvailable: boolean;
};

// Instagram regularly declines anonymous server-to-server requests, even for
// public profiles. A valid account URL should still be importable in that
// case: save the verified platform/account/source metadata rather than making
// the user retry a link that Instagram is choosing not to describe. We do not
// invent a bio or any other unavailable profile detail.
function unavailableInstagramSnapshot(target: ProfileTarget): SocialProfileSnapshot {
  return {
    sourceUrl: target.url.toString(),
    fetchedAt: new Date().toISOString(),
    platform: target.platform,
    accountName: target.accountName,
    title: null,
    description: null,
    canonicalUrl: target.url.toString(),
    siteName: "Instagram",
    hasProfileImage: false,
    metadataAvailable: false,
  };
}

export async function captureSupportedProfile(target: ProfileTarget): Promise<SocialProfileSnapshot> {
  try {
    let currentUrl = target.url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      response = await fetch(currentUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ECHO-Persona-Profile-Importer/1.0",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get("location");
      if (!location) throw new ProfileCaptureError("The profile page returned an invalid redirect.");
      const nextUrl = new URL(location, currentUrl);
      if (
        nextUrl.protocol !== "https:" ||
        (nextUrl.port && nextUrl.port !== "443") ||
        !platformForHost(nextUrl.hostname.toLowerCase())
      ) {
        throw new ProfileCaptureError("The profile page redirected outside supported social media sites.");
      }
      currentUrl = nextUrl;
    }
    if (!response || [301, 302, 303, 307, 308].includes(response.status)) {
      throw new ProfileCaptureError("The profile page redirected too many times.");
    }
    if (!response.ok) throw new ProfileCaptureError(`The profile page returned ${response.status}.`, response.status);

    // Keep imports bounded even if a provider returns an unexpectedly large page.
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 2 * 1024 * 1024) throw new ProfileCaptureError("The profile page is too large to import.");
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new ProfileCaptureError("The profile URL did not return an HTML page.");
    }
    const html = (await response.text()).slice(0, 2 * 1024 * 1024);

    return {
      sourceUrl: target.url.toString(),
      fetchedAt: new Date().toISOString(),
      platform: target.platform,
      accountName: target.accountName,
      title: metaValue(html, "og:title") ?? pageTitle(html),
      description: metaValue(html, "og:description") ?? metaValue(html, "description"),
      canonicalUrl: metaValue(html, "og:url"),
      siteName: metaValue(html, "og:site_name"),
      hasProfileImage: Boolean(metaValue(html, "og:image")),
      metadataAvailable: true,
    };
  } catch (error) {
    // A 401/403/429 response (or a connection-level failure) is Instagram
    // withholding public metadata, not proof that the syntactically valid
    // profile URL is wrong. Preserve a real 404 and our own validation errors.
    const instagramBlocked =
      target.platform === "instagram" &&
      (!(error instanceof ProfileCaptureError) || [401, 403, 429].includes(error.status ?? 0));
    if (instagramBlocked) return unavailableInstagramSnapshot(target);
    throw error;
  }
}

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X / Twitter",
  youtube: "YouTube",
  xiaohongshu: "Xiaohongshu",
};

// Compacts a captured snapshot into the single human-readable file that gets
// stored as this profile's PersonaAsset — "reading and learning from the
// account" in the only form that's honestly available from an unauthenticated
// fetch of a public page. Deliberately NOT a fake AI summary: this project has
// no model wired up (see lib/persona-ai.ts), so it's a plain, deterministic
// write-up of exactly the fields captureSupportedProfile found, with an
// explicit note about what it doesn't (and structurally can't) cover.
//
// Individual posts aren't included because they're not retrievable this way:
// Instagram/Facebook/X/YouTube/Xiaohongshu render post content via
// JavaScript behind an authentication wall for anything beyond the bare
// profile shell, and scraping around that would violate every one of these
// platforms' terms of service. The real way to ingest post history is that
// platform's official API with the account owner's OAuth consent — that's a
// per-platform developer-app integration this project doesn't have (same
// category as lib/payment.ts's unwired provider), not something achievable
// from a plain HTTPS GET.
export function formatLearnedNotes(snapshot: SocialProfileSnapshot): string {
  const capturedAt = new Date(snapshot.fetchedAt).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const facts: string[] = [];
  if (snapshot.title) facts.push(`- Page title: ${snapshot.title}`);
  if (snapshot.description) facts.push(`- Bio / description shown on the page: ${snapshot.description}`);
  if (snapshot.siteName) facts.push(`- Site: ${snapshot.siteName}`);
  facts.push(`- Profile photo detected on the page: ${snapshot.hasProfileImage ? "yes" : "no"}`);
  if (!snapshot.metadataAvailable) {
    facts.push(`- Instagram did not expose a public title, bio, or profile photo to the importer at capture time.`);
  }

  return [
    `ECHO 回响 — compacted profile notes`,
    `Platform: ${PLATFORM_LABELS[snapshot.platform]}`,
    `Account: ${snapshot.accountName}`,
    `Source: ${snapshot.canonicalUrl ?? snapshot.sourceUrl}`,
    `Captured: ${capturedAt}`,
    ``,
    `What was learned from this public profile page:`,
    ...facts,
    ``,
    snapshot.metadataAvailable
      ? `Note: this reflects only what's publicly visible in the profile page's own title, description, and metadata at the moment it was captured — it does not include individual posts, captions, comments, or photos.`
      : `Note: the valid Instagram profile link and account name were saved, but Instagram withheld its page metadata from this anonymous request. It does not include individual posts, captions, comments, or photos.`,
    `Reading someone's actual post history requires their explicit`,
    `authorization through that platform's official API, which isn't`,
    `connected here (see docs/TODO.md).`,
  ].join("\n");
}
