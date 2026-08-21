-- Additive with a default, so the running code is unaffected. Nothing reads
-- these yet; they exist so a content filter can be built later on data already
-- gathered rather than on a scramble afterwards.
ALTER TABLE "Figure" ADD COLUMN "nsfw" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Figure" ADD COLUMN "nsfwSource" TEXT;
