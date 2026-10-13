export const REPOSITORY = "Abbthan/digital-persona";
export const CONTENT_PATH = "shared/site-content.json";
export type RepositoryFile = { path: string; sha: string; size: number };
export type LoadedFile = { sha: string; text: string };
export type Commit = { sha: string; url: string };
export type BuildCheck = {
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
};
const ROOT = `/repos/${REPOSITORY}`;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function editablePath(path: string) {
  if (
    path.split("/").some((part) => !part || part.startsWith(".")) ||
    path.includes("\\")
  )
    return false;
  return (
    /^front_end\/(pages|components\/marketing)\/[-\w/]+\.tsx$/.test(path) ||
    /^app\/globals\.css$/.test(path) ||
    /^shared\/site-content\.json$/.test(path) ||
    /^public\/(images|brand)\/[-\w/]+\.(png|jpe?g|webp)$/.test(path) ||
    /^(README|ADMIN)\.md$/.test(path)
  );
}
export const imagePath = (path: string) =>
  /^public\//.test(path) && /\.(png|jpe?g|webp)$/.test(path);
export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function fromBase64(text: string) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(text.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)),
  );
}

// Only GitHub receives this credential. Never store it in cookies or storage.
export class GitHubEditor {
  #token: string;
  #fetch: typeof fetch;
  constructor(token: string, fetcher: typeof fetch = fetch) {
    this.#token = token.trim();
    this.#fetch = fetcher.bind(globalThis);
  }
  clear() {
    this.#token = "";
  }
  private async request(
    endpoint: string,
    method = "GET",
    body?: object,
  ): Promise<unknown> {
    if (!this.#token) throw new Error("Connect your GitHub access key first.");
    if (
      !endpoint.startsWith(ROOT + "/") &&
      endpoint !== ROOT &&
      endpoint !== "/user"
    )
      throw new Error("Invalid GitHub endpoint.");
    const response = await this.#fetch("https://api.github.com" + endpoint, {
      method,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.#token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      if ([409, 422].includes(response.status))
        throw new Error(
          "This file changed or main is protected. Keep your draft and reload the latest file before publishing.",
        );
      if ([401, 403, 404].includes(response.status))
        throw new Error(
          "Access denied. Use an unexpired digital-persona repository key with Contents: Read and write. Build status also needs Checks: Read.",
        );
      throw new Error(
        `GitHub returned ${response.status}. Check the repository before retrying a publish.`,
      );
    }
    return response.json();
  }
  async connect() {
    const [repo, user] = await Promise.all([
      this.request(ROOT),
      this.request("/user"),
    ]);
    if (
      !record(repo) ||
      repo.full_name !== REPOSITORY ||
      !record(repo.permissions) ||
      repo.permissions.push !== true ||
      !record(user) ||
      typeof user.login !== "string"
    )
      throw new Error(
        "This GitHub account does not have repository write access.",
      );
    return user.login;
  }
  async listFiles(): Promise<RepositoryFile[]> {
    const result = await this.request(`${ROOT}/git/trees/main?recursive=1`);
    if (!record(result) || result.truncated || !Array.isArray(result.tree))
      throw new Error("Could not load the complete file list.");
    return result.tree.flatMap((item) =>
      record(item) &&
      item.type === "blob" &&
      typeof item.path === "string" &&
      typeof item.sha === "string" &&
      typeof item.size === "number" &&
      editablePath(item.path)
        ? [{ path: item.path, sha: item.sha, size: item.size }]
        : [],
    );
  }
  async loadText(path: string): Promise<LoadedFile> {
    if (!editablePath(path) || imagePath(path))
      throw new Error("This text file is not editable here.");
    const result = await this.request(
      `${ROOT}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`,
    );
    if (
      !record(result) ||
      result.type !== "file" ||
      result.encoding !== "base64" ||
      typeof result.content !== "string" ||
      typeof result.sha !== "string" ||
      typeof result.size !== "number" ||
      result.size > 800000
    )
      throw new Error("The file is too large or not supported.");
    return { sha: result.sha, text: fromBase64(result.content) };
  }
  async loadImage(path: string): Promise<{ sha: string; base64: string }> {
    if (!editablePath(path) || !imagePath(path))
      throw new Error("This image is not editable here.");
    const result = await this.request(
      `${ROOT}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`,
    );
    if (
      !record(result) ||
      result.type !== "file" ||
      typeof result.sha !== "string" ||
      !/^[a-f0-9]{40}$/.test(result.sha) ||
      typeof result.size !== "number" ||
      result.size > 5 * 1024 * 1024
    )
      throw new Error("This image is too large for the editor.");
    // Contents returns no Base64 for files over 1 MB. Blob retrieval handles
    // existing artwork such as the 1.9 MB founder portrait without a CDN
    // redirect or sending the credential to another host.
    const blob = await this.request(`${ROOT}/git/blobs/${result.sha}`);
    if (
      !record(blob) ||
      blob.encoding !== "base64" ||
      typeof blob.content !== "string" ||
      typeof blob.size !== "number" ||
      blob.size > 5 * 1024 * 1024 ||
      blob.sha !== result.sha
    )
      throw new Error("Could not load this image from GitHub.");
    return { sha: result.sha, base64: blob.content.replace(/\s/g, "") };
  }
  async publish(
    path: string,
    base64: string,
    sha: string,
    message: string,
  ): Promise<Commit> {
    if (
      !editablePath(path) ||
      !sha ||
      !message.trim() ||
      message.length > 200 ||
      base64.length > (imagePath(path) ? 7000000 : 1100000)
    )
      throw new Error("Invalid publication or file size.");
    const result = await this.request(
      `${ROOT}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      "PUT",
      { content: base64, sha, branch: "main", message: message.trim() },
    );
    if (
      !record(result) ||
      !record(result.commit) ||
      typeof result.commit.sha !== "string" ||
      typeof result.commit.html_url !== "string" ||
      !result.commit.html_url.startsWith(
        `https://github.com/${REPOSITORY}/commit/`,
      )
    )
      throw new Error(
        "GitHub did not confirm the commit. Check the repository before retrying.",
      );
    return { sha: result.commit.sha, url: result.commit.html_url };
  }
  async checks(sha: string): Promise<BuildCheck[]> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit.");
    const result = await this.request(`${ROOT}/commits/${sha}/check-runs`);
    if (!record(result) || !Array.isArray(result.check_runs))
      throw new Error("Could not read build checks.");
    return result.check_runs.flatMap((check) =>
      record(check) &&
      typeof check.name === "string" &&
      typeof check.status === "string"
        ? [
            {
              name: check.name,
              status: check.status,
              conclusion:
                typeof check.conclusion === "string" ? check.conclusion : null,
              url:
                typeof check.details_url === "string" &&
                /^https:\/\/(github\.com|dash\.cloudflare\.com)\//.test(
                  check.details_url,
                )
                  ? check.details_url
                  : null,
            },
          ]
        : [],
    );
  }
}
