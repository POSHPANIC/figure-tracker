-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "supersededById" TEXT;

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Figure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
