-- The application only reaches PostgreSQL through its authenticated Worker /
-- Prisma database role.  These tables have no browser-facing data API, so
-- enabling RLS with no public policies blocks direct PostgREST access while
-- preserving the trusted server-side access path.
ALTER TABLE "CommunityMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformMetric" ENABLE ROW LEVEL SECURITY;
