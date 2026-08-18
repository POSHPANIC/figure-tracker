-- AlterEnum
ALTER TYPE "SubmissionKind" ADD VALUE 'SALE';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "saleAmount" DECIMAL(12,2),
ADD COLUMN     "saleCondition" "ItemCondition",
ADD COLUMN     "saleCurrency" VARCHAR(3),
ADD COLUMN     "saleDate" TIMESTAMP(3),
ADD COLUMN     "saleFlag" TEXT,
ADD COLUMN     "saleUrl" TEXT;
