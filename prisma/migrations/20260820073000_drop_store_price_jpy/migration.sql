-- The contract half of an expand-and-contract. storePriceAmount and
-- storePriceCurrency were added alongside this column, its one value was copied
-- across and marked JPY, and the code that read it is off production. Verified
-- before running: no row carried a price only in this column, and none of the
-- copied values disagreed.
ALTER TABLE "Figure" DROP COLUMN "storePriceJpy";
