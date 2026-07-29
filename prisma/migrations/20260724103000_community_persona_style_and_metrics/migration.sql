ALTER TABLE "Persona"
ADD COLUMN IF NOT EXISTS "avatarStyle" TEXT NOT NULL DEFAULT 'realistic';

CREATE TABLE IF NOT EXISTS "PlatformMetric" (
  "id" TEXT NOT NULL,
  "personasCreated" INTEGER NOT NULL DEFAULT 0,
  "messagesExchanged" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformMetric_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformMetric" ("id", "personasCreated", "messagesExchanged", "updatedAt")
SELECT
  'global',
  (SELECT COUNT(*)::INTEGER FROM "Persona"),
  (SELECT COUNT(*)::INTEGER FROM "ChatMessage"),
  CURRENT_TIMESTAMP
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "CommunityMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CommunityMessage_createdAt_idx" ON "CommunityMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "CommunityMessage_userId_createdAt_idx" ON "CommunityMessage"("userId", "createdAt");
