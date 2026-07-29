import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type HyperdriveBinding = { connectionString: string };

function getConnectionString(): string {
  // In the deployed Worker, Hyperdrive supplies a pooled connection string.
  // The try/catch preserves the regular local Next.js development workflow,
  // where Cloudflare bindings are intentionally unavailable.
  try {
    const hyperdrive = getCloudflareContext().env.HYPERDRIVE as unknown as HyperdriveBinding | undefined;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;
  } catch {
    // Local development and build-time evaluation use DATABASE_URL below.
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("DATABASE_URL is missing and the Cloudflare Hyperdrive binding is unavailable.");
}

/**
 * Create a client within the current request. Cloudflare Workers cannot reuse
 * a database connection created in a previous request's I/O context, so a
 * module-level singleton intermittently made otherwise-valid sessions look
 * logged out after unrelated database work such as a profile-picture upload.
 */
export function getDb(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: getConnectionString() }),
  });
}
