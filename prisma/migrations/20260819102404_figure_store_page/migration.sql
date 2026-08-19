-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "storeAvailable" BOOLEAN,
ADD COLUMN     "storeCheckedAt" TIMESTAMP(3),
ADD COLUMN     "storeClosesAt" TIMESTAMP(3),
ADD COLUMN     "storePriceJpy" INTEGER,
ADD COLUMN     "storeUrl" TEXT;
