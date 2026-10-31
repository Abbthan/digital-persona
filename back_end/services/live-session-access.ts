import { Client } from "pg";
import { getSession } from "@/back_end/services/session";
import { resolveConnection } from "@/back_end/services/database-connection";
import { hasPaidAccess } from "@/back_end/services/limits";

type LiveSessionRow = {
  userId: string;
  emailVerified: boolean;
  subscriptionStatus: string | null;
  subscriptionRenewsAt: Date | null;
  id: string | null;
  status: string | null;
  liveAvatarId: string | null;
  voiceRefTranscript: string | null;
};

type LiveSessionAccess =
  | { ok: false; status: number; error: string }
  | { ok: true; userId: string; persona: {
    id: string; status: string | null; liveAvatarId: string | null; voiceRefTranscript: string | null;
  } };

// No cache of account/ownership decisions, and no global database sockets.
// Hyperdrive still provides the existing connection pool. One parameterised
// join replaces two Prisma engines/queries on this latency-critical path.
export async function getLiveSessionAccess(
  personaId: string,
  { requirePaid = true, requireActive = true, requireAvatar = false } = {},
): Promise<LiveSessionAccess> {
  const session = await getSession().catch(() => null);
  if (!session?.userId) return { ok: false, status: 401, error: "You're not logged in." };
  let client: Client | undefined;
  try {
    client = new Client({
      connectionString: resolveConnection().connectionString,
      connectionTimeoutMillis: 4_000,
      query_timeout: 5_000,
    });
    await client.connect();
    const { rows } = await client.query<LiveSessionRow>(`
      SELECT u.id AS "userId", u."emailVerified", u."subscriptionStatus", u."subscriptionRenewsAt",
             p.id, p.status, p."liveAvatarId", p."voiceRefTranscript"
      FROM "User" u
      LEFT JOIN "Persona" p ON p."userId" = u.id AND p.id = $2
      WHERE u.id = $1
      LIMIT 1`, [session.userId, personaId]);
    const row = rows[0];
    if (!row?.emailVerified) return { ok: false, status: 401, error: "You're not logged in." };
    if (requirePaid && !hasPaidAccess(row.subscriptionStatus, row.subscriptionRenewsAt)) {
      return { ok: false, status: 403, error: "Real-time voice and video conversation is a subscriber feature." };
    }
    if (!row.id) return { ok: false, status: 404, error: "Persona not found." };
    if (requireActive && row.status !== "active") {
      return { ok: false, status: 409, error: "This persona is still being prepared." };
    }
    if (requireAvatar && !row.liveAvatarId) {
      return { ok: false, status: 409, error: "Complete both the guided and passive facial scans to enable live video." };
    }
    return { ok: true, userId: row.userId, persona: {
      id: row.id, status: row.status, liveAvatarId: row.liveAvatarId, voiceRefTranscript: row.voiceRefTranscript,
    } };
  } catch {
    console.error("[live-session] access lookup unavailable");
    return { ok: false, status: 503, error: "Couldn't start a live session — the database is temporarily unavailable." };
  } finally {
    await client?.end().catch(() => {});
  }
}
