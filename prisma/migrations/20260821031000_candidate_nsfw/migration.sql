-- The candidate carries the source's classification from discovery through to
-- the figure it becomes, so a retailer's own labelling is not lost between the
-- two steps and re-derived from a name instead.
ALTER TABLE "FigureCandidate" ADD COLUMN "nsfw" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FigureCandidate" ADD COLUMN "nsfwSource" TEXT;
