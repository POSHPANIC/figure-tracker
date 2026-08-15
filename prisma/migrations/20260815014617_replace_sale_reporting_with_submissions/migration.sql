/*
  Warnings:

  - You are about to drop the column `flagReason` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `isUserReported` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `reportedById` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `reviewNote` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedAt` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedById` on the `Sale` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Sale` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('FEEDBACK', 'BUG', 'FIGURE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('OPEN', 'RESOLVED', 'DECLINED');

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_reportedById_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_reviewedById_fkey";

-- DropIndex
DROP INDEX "Sale_figureId_status_condition_soldAt_idx";

-- DropIndex
DROP INDEX "Sale_reportedById_createdAt_idx";

-- DropIndex
DROP INDEX "Sale_status_createdAt_idx";

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "flagReason",
DROP COLUMN "isUserReported",
DROP COLUMN "reportedById",
DROP COLUMN "reviewNote",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedById",
DROP COLUMN "status";

-- DropEnum
DROP TYPE "SaleStatus";

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'OPEN',
    "details" TEXT NOT NULL,
    "pageUrl" TEXT,
    "figureName" TEXT,
    "manufacturer" TEXT,
    "series" TEXT,
    "referenceUrl" TEXT,
    "userId" TEXT,
    "contactEmail" TEXT,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "handlerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_status_createdAt_idx" ON "Submission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_kind_status_idx" ON "Submission"("kind", "status");

-- CreateIndex
CREATE INDEX "Submission_userId_createdAt_idx" ON "Submission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_figureId_condition_soldAt_idx" ON "Sale"("figureId", "condition", "soldAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
