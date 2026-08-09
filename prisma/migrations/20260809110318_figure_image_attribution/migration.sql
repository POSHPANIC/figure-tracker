-- DropIndex
DROP INDEX "FigureImage_figureId_idx";

-- AlterTable
ALTER TABLE "FigureImage" ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "credit" TEXT,
ADD COLUMN     "licenseNote" TEXT,
ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE INDEX "FigureImage_figureId_sortOrder_idx" ON "FigureImage"("figureId", "sortOrder");

-- AddForeignKey
ALTER TABLE "FigureImage" ADD CONSTRAINT "FigureImage_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
