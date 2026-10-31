/** Keep working Responses providers unchanged; adapt text-only requests for
 * compatible gateways whose configured channel only exposes Chat Completions.
 * Credentials and persona context never leave the originally configured host.
 */
export async function fetchPersonaModel(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok || ![404, 405, 501, 503].includes(response.status)) return response;
  const failure = await response.clone().json().catch(() => ({})) as { error?: { message?: unknown } };
  if (response.status === 503 && !(typeof failure.error?.message === "string"
    && failure.error.message.toLowerCase().includes("no available channel"))) return response;
  if (typeof init.body !== "string") return response;
  const input = JSON.parse(init.body) as { model?: unknown; instructions?: unknown; input?: unknown; max_output_tokens?: unknown };
  if (typeof input.model !== "string" || typeof input.instructions !== "string" || typeof input.input !== "string") return response;
  const alternate = new URL(url);
  if (!alternate.pathname.endsWith("/responses")) return response;
  alternate.pathname = alternate.pathname.slice(0, -"/responses".length) + "/chat/completions";
  console.info("[persona-ai] trying compatible chat transport", { host: alternate.host, model: input.model });
  const completion = await fetch(alternate, {
    ...init,
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "system", content: input.instructions }, { role: "user", content: input.input }],
      max_completion_tokens: input.max_output_tokens,
    }),
  });
  if (!completion.ok) return completion;
  const body = await completion.json() as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  return Response.json({ output_text: typeof content === "string" ? content : "" });
}
