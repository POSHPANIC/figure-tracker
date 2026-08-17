-- CreateTable
CREATE TABLE "FigureFieldLock" (
    "id" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "note" TEXT,
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FigureFieldLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FigureFieldLock_figureId_idx" ON "FigureFieldLock"("figureId");

-- CreateIndex
CREATE UNIQUE INDEX "FigureFieldLock_figureId_field_key" ON "FigureFieldLock"("figureId", "field");

-- AddForeignKey
ALTER TABLE "FigureFieldLock" ADD CONSTRAINT "FigureFieldLock_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigureFieldLock" ADD CONSTRAINT "FigureFieldLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
