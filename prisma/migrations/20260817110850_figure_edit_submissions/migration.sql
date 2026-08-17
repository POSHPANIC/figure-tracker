-- AlterEnum
ALTER TYPE "SubmissionKind" ADD VALUE 'EDIT';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "figureId" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- CreateIndex
CREATE INDEX "Submission_figureId_createdAt_idx" ON "Submission"("figureId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
