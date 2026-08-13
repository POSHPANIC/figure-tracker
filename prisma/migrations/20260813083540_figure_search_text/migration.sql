-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "searchText" TEXT;

-- CreateIndex
CREATE INDEX "Figure_searchText_idx" ON "Figure"("searchText");
