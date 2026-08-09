-- CreateEnum
CREATE TYPE "FigureCategory" AS ENUM ('SCALE', 'NENDOROID', 'FIGMA', 'PRIZE', 'TRADING', 'GARAGE_KIT', 'MODEL_KIT', 'PLUSH', 'OTHER');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('ANNOUNCED', 'PREORDER', 'RELEASED', 'DELAYED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW_SEALED', 'NEW_OPENED', 'USED_COMPLETE', 'USED_INCOMPLETE', 'DAMAGED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "seriesId" TEXT,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Figure" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameJa" TEXT,
    "description" TEXT,
    "category" "FigureCategory" NOT NULL DEFAULT 'OTHER',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'RELEASED',
    "scale" TEXT,
    "heightMm" INTEGER,
    "releaseDate" TIMESTAMP(3),
    "msrpAmount" DECIMAL(12,2),
    "msrpCurrency" VARCHAR(3),
    "primaryImageUrl" TEXT,
    "manufacturerId" TEXT,
    "seriesId" TEXT,
    "marketValueUsd" DECIMAL(12,2),
    "change30dPct" DECIMAL(8,2),
    "salesVolume90d" INTEGER NOT NULL DEFAULT 0,
    "lastAggregatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Figure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FigureImage" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FigureImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FigureIdentifier" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "FigureIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "figureId" TEXT,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "condition" "ItemCondition" NOT NULL DEFAULT 'UNKNOWN',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "fxRate" DECIMAL(18,8) NOT NULL,
    "shippingUsd" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchScore" DOUBLE PRECISION,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "url" TEXT,
    "condition" "ItemCondition" NOT NULL DEFAULT 'UNKNOWN',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "fxRate" DECIMAL(18,8) NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "isUserReported" BOOLEAN NOT NULL DEFAULT false,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "date" DATE NOT NULL,
    "minUsd" DECIMAL(12,2) NOT NULL,
    "medianUsd" DECIMAL(12,2) NOT NULL,
    "avgUsd" DECIMAL(12,2) NOT NULL,
    "maxUsd" DECIMAL(12,2) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "lowestAskUsd" DECIMAL(12,2),

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rateToUsd" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "username" TEXT,
    "bio" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "publicProfile" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" "ItemCondition" NOT NULL DEFAULT 'NEW_SEALED',
    "paidAmount" DECIMAL(12,2),
    "paidCurrency" VARCHAR(3),
    "purchasedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "targetUsd" DECIMAL(12,2) NOT NULL,
    "condition" "ItemCondition" NOT NULL DEFAULT 'NEW_SEALED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFired" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FigureCharacters" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FigureCharacters_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_slug_key" ON "Manufacturer"("slug");

-- CreateIndex
CREATE INDEX "Manufacturer_slug_idx" ON "Manufacturer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Series_name_key" ON "Series"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");

-- CreateIndex
CREATE INDEX "Series_slug_idx" ON "Series"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Character_slug_key" ON "Character"("slug");

-- CreateIndex
CREATE INDEX "Character_slug_idx" ON "Character"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_seriesId_key" ON "Character"("name", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "Figure_slug_key" ON "Figure"("slug");

-- CreateIndex
CREATE INDEX "Figure_slug_idx" ON "Figure"("slug");

-- CreateIndex
CREATE INDEX "Figure_manufacturerId_idx" ON "Figure"("manufacturerId");

-- CreateIndex
CREATE INDEX "Figure_seriesId_idx" ON "Figure"("seriesId");

-- CreateIndex
CREATE INDEX "Figure_category_idx" ON "Figure"("category");

-- CreateIndex
CREATE INDEX "Figure_marketValueUsd_idx" ON "Figure"("marketValueUsd");

-- CreateIndex
CREATE INDEX "Figure_releaseDate_idx" ON "Figure"("releaseDate");

-- CreateIndex
CREATE INDEX "FigureImage_figureId_idx" ON "FigureImage"("figureId");

-- CreateIndex
CREATE INDEX "FigureIdentifier_figureId_idx" ON "FigureIdentifier"("figureId");

-- CreateIndex
CREATE UNIQUE INDEX "FigureIdentifier_kind_value_key" ON "FigureIdentifier"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "Listing_figureId_isActive_idx" ON "Listing"("figureId", "isActive");

-- CreateIndex
CREATE INDEX "Listing_lastSeen_idx" ON "Listing"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_sourceId_externalId_key" ON "Listing"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "Sale_figureId_soldAt_idx" ON "Sale"("figureId", "soldAt");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_sourceId_externalId_key" ON "Sale"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_figureId_date_idx" ON "PriceSnapshot"("figureId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_figureId_condition_date_key" ON "PriceSnapshot"("figureId", "condition", "date");

-- CreateIndex
CREATE INDEX "IngestRun_sourceId_startedAt_idx" ON "IngestRun"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_currency_date_key" ON "FxRate"("currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "CollectionItem_userId_idx" ON "CollectionItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionItem_userId_figureId_condition_key" ON "CollectionItem"("userId", "figureId", "condition");

-- CreateIndex
CREATE INDEX "WishlistItem_userId_idx" ON "WishlistItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_userId_figureId_key" ON "WishlistItem"("userId", "figureId");

-- CreateIndex
CREATE INDEX "PriceAlert_active_idx" ON "PriceAlert"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_figureId_condition_key" ON "PriceAlert"("userId", "figureId", "condition");

-- CreateIndex
CREATE INDEX "_FigureCharacters_B_index" ON "_FigureCharacters"("B");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigureImage" ADD CONSTRAINT "FigureImage_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigureIdentifier" ADD CONSTRAINT "FigureIdentifier_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestRun" ADD CONSTRAINT "IngestRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FigureCharacters" ADD CONSTRAINT "_FigureCharacters_A_fkey" FOREIGN KEY ("A") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FigureCharacters" ADD CONSTRAINT "_FigureCharacters_B_fkey" FOREIGN KEY ("B") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
