/*
  Warnings:

  - You are about to drop the `EmailVerificationCode` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EmailVerificationCode" DROP CONSTRAINT "EmailVerificationCode_userId_fkey";

-- DropTable
DROP TABLE "EmailVerificationCode";

-- CreateTable
CREATE TABLE "PendingPasswordChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newPasswordHash" TEXT NOT NULL,
    "verificationCodeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPasswordChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsernameChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsernameChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingPasswordChange_userId_key" ON "PendingPasswordChange"("userId");

-- CreateIndex
CREATE INDEX "UsernameChange_userId_createdAt_idx" ON "UsernameChange"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PendingPasswordChange" ADD CONSTRAINT "PendingPasswordChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameChange" ADD CONSTRAINT "UsernameChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
