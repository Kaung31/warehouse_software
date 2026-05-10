-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('INBOUND_AREA', 'WARRANTY_RACK', 'BGRADE_AREA', 'MECHANIC_QUEUE', 'QC_RACK', 'DISPATCH_AREA', 'STORAGE');

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "barcodeAssigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentLocationId" TEXT;

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_code_key" ON "WarehouseLocation"("code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_type_idx" ON "WarehouseLocation"("type");

-- CreateIndex
CREATE INDEX "WarehouseLocation_isActive_idx" ON "WarehouseLocation"("isActive");

-- CreateIndex
CREATE INDEX "RepairOrder_currentLocationId_idx" ON "RepairOrder"("currentLocationId");

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
