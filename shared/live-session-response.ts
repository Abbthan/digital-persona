// Edge failures can return an HTML error page before a route handler runs.
// Never expose that HTML (or a JSON parser stack) as an avatar-server error.
export async function readLiveSessionResponse(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`The website gateway is temporarily unavailable (HTTP ${response.status}). Please retry.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The website gateway returned an invalid response. Please retry.");
  }
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : `Avatar connection request failed (HTTP ${response.status}).`;
    throw new Error(detail);
  }
  return body;
}
