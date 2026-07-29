import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The default adapter settings are sufficient for this app. Persistent data
// stays in Supabase Postgres and Supabase Storage; Cloudflare serves the
// Next.js runtime and static assets.
export default defineCloudflareConfig();
