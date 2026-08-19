-- CreateTable
CREATE TABLE "FxMonthly" (
    "id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "month" DATE NOT NULL,
    "rateToUsd" DECIMAL(18,8) NOT NULL,
    "days" INTEGER NOT NULL,

    CONSTRAINT "FxMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxMonthly_currency_month_key" ON "FxMonthly"("currency", "month");
