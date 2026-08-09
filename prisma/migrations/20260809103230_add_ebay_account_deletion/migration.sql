-- CreateTable
CREATE TABLE "EbayAccountDeletion" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userRefHash" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordsErased" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EbayAccountDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayAccountDeletion_notificationId_key" ON "EbayAccountDeletion"("notificationId");

-- CreateIndex
CREATE INDEX "EbayAccountDeletion_userRefHash_idx" ON "EbayAccountDeletion"("userRefHash");

-- CreateIndex
CREATE INDEX "EbayAccountDeletion_receivedAt_idx" ON "EbayAccountDeletion"("receivedAt");
