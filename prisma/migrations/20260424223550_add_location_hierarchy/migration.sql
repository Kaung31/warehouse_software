-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'RACK';

-- AlterTable
ALTER TABLE "WarehouseLocation" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "WarehouseLocation_parentId_idx" ON "WarehouseLocation"("parentId");

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
