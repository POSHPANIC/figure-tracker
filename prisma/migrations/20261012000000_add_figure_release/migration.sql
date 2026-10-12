-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "reissueDueAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FigureRelease" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "code" TEXT NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "label" TEXT,
    "releaseDate" TIMESTAMP(3),
    "releaseDatePrecision" VARCHAR(5) NOT NULL DEFAULT 'MONTH',
    "preorderOpensAt" TIMESTAMP(3),
    "preorderClosesAt" TIMESTAMP(3),
    "priceAmount" DECIMAL(12,2),
    "priceCurrency" VARCHAR(3),
    "jan" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FigureRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FigureRelease_releaseDate_idx" ON "FigureRelease"("releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "FigureRelease_figureId_source_code_key" ON "FigureRelease"("figureId", "source", "code");

-- AddForeignKey
ALTER TABLE "FigureRelease" ADD CONSTRAINT "FigureRelease_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

