-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "askListings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "askMedianUsd" DECIMAL(12,2);
