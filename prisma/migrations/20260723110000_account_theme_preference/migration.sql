-- Account-backed appearance preference. Existing accounts start with the
-- previous default behavior (System) and can then choose Light, Dark, or
-- System from Account Settings; the Worker is the only database caller, so
-- the existing RLS posture remains unchanged.
ALTER TABLE "User" ADD COLUMN "themePreference" TEXT NOT NULL DEFAULT 'system';
