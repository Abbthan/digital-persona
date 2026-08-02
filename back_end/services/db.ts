import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type HyperdriveBinding = { connectionString: string };

// In the deployed Worker, Hyperdrive supplies a pooled connection string.
// The try/catch preserves the regular local Next.js development workflow,
// where Cloudflare bindings are intentionally unavailable. Whether the
// Hyperdrive binding resolved also tells getDb() below which runtime this
// is — Workers vs. local `next dev` — since they need different client
// lifetimes.
function resolveConnection(): { connectionString: string; isWorkersRuntime: boolean } {
  try {
    const hyperdrive = getCloudflareContext().env.HYPERDRIVE as unknown as HyperdriveBinding | undefined;
    if (hyperdrive?.connectionString) {
      return { connectionString: hyperdrive.connectionString, isWorkersRuntime: true };
    }
  } catch {
    // Local development and build-time evaluation use DATABASE_URL below.
  }

  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, isWorkersRuntime: false };
  throw new Error("DATABASE_URL is missing and the Cloudflare Hyperdrive binding is unavailable.");
}

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
