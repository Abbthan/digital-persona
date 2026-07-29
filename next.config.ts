import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext needs the full package so it can select pg-cloudflare's `workerd`
  // export at bundle time. `pg` itself is automatically externalized by Next.
  serverExternalPackages: ["pg-cloudflare"],
  // React Strict Mode double-invokes newly-mounted components in dev (to
  // surface effect-cleanup bugs) — always stripped from production builds,
  // never runs for real users. It collides with Framer Motion's AnimatePresence
  // page-transition animation in components/PageTransition.tsx: the freshly
  // mounted page gets mounted, faked-unmounted, and remounted in quick
  // succession, which looks like "content swaps instantly, then flickers"
  // in the dev preview even though the animation itself is correct (verified
  // against a production build, where it fades cleanly). Disabled so the dev
  // preview matches what actually ships.
  reactStrictMode: false,
};

export default nextConfig;
