-- CreateTable
CREATE TABLE "SourceProduct" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "nameJa" TEXT,
    "seriesEn" TEXT,
    "seriesJa" TEXT,
    "manufacturerName" TEXT,
    "msrpAmount" DECIMAL(12,2),
    "msrpCurrency" VARCHAR(3),
    "scale" TEXT,
    "heightMm" INTEGER,
    "releaseDate" TIMESTAMP(3),
    "jan" TEXT,
    "figureId" TEXT,
    "linkedBy" TEXT,
    "linkedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceProduct_key_key" ON "SourceProduct"("key");

-- CreateIndex
CREATE INDEX "SourceProduct_source_figureId_idx" ON "SourceProduct"("source", "figureId");

-- CreateIndex
CREATE INDEX "SourceProduct_nameJa_idx" ON "SourceProduct"("nameJa");

-- AddForeignKey
ALTER TABLE "SourceProduct" ADD CONSTRAINT "SourceProduct_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
