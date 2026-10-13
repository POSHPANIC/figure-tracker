-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "rejectedFigureIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

