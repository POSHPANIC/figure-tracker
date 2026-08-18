-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "FigureCandidate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "listingCount" INTEGER NOT NULL DEFAULT 0,
    "sampleTitles" TEXT[],
    "status" "CandidateStatus" NOT NULL DEFAULT 'OPEN',
    "figureId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "FigureCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FigureCandidate_key_key" ON "FigureCandidate"("key");

-- CreateIndex
CREATE INDEX "FigureCandidate_status_listingCount_idx" ON "FigureCandidate"("status", "listingCount");

-- AddForeignKey
ALTER TABLE "FigureCandidate" ADD CONSTRAINT "FigureCandidate_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
