-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "aliases" TEXT[],
ADD COLUMN     "anilistId" INTEGER,
ADD COLUMN     "nameJa" TEXT;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "anilistId" INTEGER,
ADD COLUMN     "synonyms" TEXT[],
ADD COLUMN     "titleJa" TEXT;
