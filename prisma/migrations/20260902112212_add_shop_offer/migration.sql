-- CreateTable
CREATE TABLE "ShopOffer" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "url" TEXT NOT NULL,
    "priceAmount" DECIMAL(12,2),
    "priceCurrency" VARCHAR(3),
    "available" BOOLEAN,
    "closesAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopOffer_figureId_idx" ON "ShopOffer"("figureId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOffer_figureId_source_key" ON "ShopOffer"("figureId", "source");

-- AddForeignKey
ALTER TABLE "ShopOffer" ADD CONSTRAINT "ShopOffer_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
