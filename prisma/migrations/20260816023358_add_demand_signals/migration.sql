-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Figure_lastPolledAt_idx" ON "Figure"("lastPolledAt");
