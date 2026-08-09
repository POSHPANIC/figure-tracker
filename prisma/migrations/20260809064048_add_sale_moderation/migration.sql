-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "SaleStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "Sale_figureId_status_condition_soldAt_idx" ON "Sale"("figureId", "status", "condition", "soldAt");

-- CreateIndex
CREATE INDEX "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_reportedById_createdAt_idx" ON "Sale"("reportedById", "createdAt");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
