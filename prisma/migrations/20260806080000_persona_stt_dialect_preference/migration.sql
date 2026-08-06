ALTER TABLE "Persona"
ADD COLUMN IF NOT EXISTS "sttDialectPreference" TEXT NOT NULL DEFAULT 'mandarin';
