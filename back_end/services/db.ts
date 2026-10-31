import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveConnection } from "@/back_end/services/database-connection";

const globalForDb = globalThis as unknown as { __dbClient?: PrismaClient };

/**
 * In the deployed Worker, create a fresh client within the current request.
 * Cloudflare Workers cannot reuse a database connection created in a
 * previous request's I/O context, so a module-level singleton there
 * intermittently made otherwise-valid sessions look logged out after
 * unrelated database work such as a profile-picture upload.
 *
 * Local `next dev` is a normal long-running Node process with no such
 * restriction, and creating a fresh PrismaClient (and therefore a fresh
 * Postgres connection) on every request there quickly exhausts Supabase's
 * session-pooler connection cap (15 clients) under ordinary dashboard
 * usage. It reuses one cached client instead, cleared on every hot reload
 * via `globalThis` so `next dev`'s module re-evaluation doesn't leak a new
 * client (and its connection) each time.
 */
export function getDb(): PrismaClient {
  const { connectionString, isWorkersRuntime } = resolveConnection();
  if (isWorkersRuntime) {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  if (!globalForDb.__dbClient) {
    // Capped well under Supabase's 15-client session-pooler limit: this
    // singleton holds its connections open for reuse (the point of
    // pooling), and a default-sized pool here left almost no room for
    // other local tooling (scripts, migrations) sharing the same pooler.
    globalForDb.__dbClient = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) });
  }
  return globalForDb.__dbClient;
}
