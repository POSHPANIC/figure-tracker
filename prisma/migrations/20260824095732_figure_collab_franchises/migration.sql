-- CreateTable
CREATE TABLE "_FigureCollabFranchise" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FigureCollabFranchise_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FigureCollabFranchise_B_index" ON "_FigureCollabFranchise"("B");

-- AddForeignKey
ALTER TABLE "_FigureCollabFranchise" ADD CONSTRAINT "_FigureCollabFranchise_A_fkey" FOREIGN KEY ("A") REFERENCES "Figure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FigureCollabFranchise" ADD CONSTRAINT "_FigureCollabFranchise_B_fkey" FOREIGN KEY ("B") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
