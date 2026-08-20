-- Additive with a default, so the running code is unaffected and every existing
-- row gets the honest answer: the Good Smile archive and the Kotobukiya store
-- both state a month and no day, which is why those dates carry a placeholder
-- day of 15.
ALTER TABLE "Figure" ADD COLUMN "releaseDatePrecision" VARCHAR(5) NOT NULL DEFAULT 'MONTH';
