-- Keep a small server-side record of accepted support questions so the
-- two-question rolling 24-hour limit is reliable across browsers/devices.
CREATE TABLE "FaqQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaqQuestion_userId_createdAt_idx" ON "FaqQuestion"("userId", "createdAt");

ALTER TABLE "FaqQuestion" ADD CONSTRAINT "FaqQuestion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FaqQuestion" ENABLE ROW LEVEL SECURITY;
