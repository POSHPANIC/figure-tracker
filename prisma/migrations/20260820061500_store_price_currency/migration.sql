-- Additive on purpose. The code running in production still reads
-- "storePriceJpy"; renaming the column in one step would 500 every figure page
-- for the minutes between this migration and the deploy that follows it.
-- The old column is dropped in a later migration, once nothing reads it.
ALTER TABLE "Figure" ADD COLUMN "storePriceAmount" DECIMAL(12,2);
ALTER TABLE "Figure" ADD COLUMN "storePriceCurrency" VARCHAR(3);

-- Everything recorded before this came from goodsmile.com and was yen.
UPDATE "Figure"
   SET "storePriceAmount" = "storePriceJpy", "storePriceCurrency" = 'JPY'
 WHERE "storePriceJpy" IS NOT NULL;
