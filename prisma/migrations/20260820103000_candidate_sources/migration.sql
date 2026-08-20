-- Candidates can now come from a retailer's catalogue as well as from eBay
-- listings, and most figures outside the Nendoroid and figma lines carry no
-- release number at all.
--
-- Additive and widening only, so the code running in production is unaffected:
-- it reads line and number as non-null and every existing row still has them.
ALTER TABLE "FigureCandidate" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'EBAY_LISTINGS';
ALTER TABLE "FigureCandidate" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "FigureCandidate" ADD COLUMN "vendor" TEXT;
ALTER TABLE "FigureCandidate" ALTER COLUMN "line" DROP NOT NULL;
ALTER TABLE "FigureCandidate" ALTER COLUMN "number" DROP NOT NULL;
