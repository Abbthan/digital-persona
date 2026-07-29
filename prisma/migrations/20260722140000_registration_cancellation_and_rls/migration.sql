-- A pending registration is not an account. Its owner receives this
-- unguessable capability in the browser so closing/reloading that browser can
-- release the temporary username/email reservation without letting another
-- client cancel it.
ALTER TABLE "PendingRegistration" ADD COLUMN "cancellationTokenHash" TEXT;

-- The web app accesses its data only through the Worker/database role; it
-- never exposes a Supabase database key to browsers. Enabling RLS with no
-- browser-facing policies therefore blocks direct PostgREST access while the
-- trusted server-side role continues to work as before.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingPasswordChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsernameChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Persona" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
