import { getCloudflareContext } from "@opennextjs/cloudflare";

// Shared connection resolution only. Keep Prisma out of callers which need
// one small SQL query: loading/initialising its engine spends edge CPU too.
export function resolveConnection(): { connectionString: string; isWorkersRuntime: boolean } {
  try {
    const hyperdrive = getCloudflareContext().env.HYPERDRIVE;
    if (hyperdrive?.connectionString) {
      return { connectionString: hyperdrive.connectionString, isWorkersRuntime: true };
    }
  } catch {
    // Local development/builds have no Cloudflare request context.
  }
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, isWorkersRuntime: false };
  throw new Error("DATABASE_URL is missing and the Cloudflare Hyperdrive binding is unavailable.");
}
