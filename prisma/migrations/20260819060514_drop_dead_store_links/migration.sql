/*
  Warnings:

  - You are about to drop the column `storeCheckedAt` on the `Figure` table. All the data in the column will be lost.
  - You are about to drop the column `storeUrlIntl` on the `Figure` table. All the data in the column will be lost.
  - You are about to drop the column `storeUrlUs` on the `Figure` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Figure" DROP COLUMN "storeCheckedAt",
DROP COLUMN "storeUrlIntl",
DROP COLUMN "storeUrlUs";
