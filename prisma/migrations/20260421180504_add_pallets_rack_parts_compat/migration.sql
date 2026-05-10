-- CreateEnum
CREATE TYPE "PalletPurpose" AS ENUM ('BGRADE', 'HOLDING');

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "compatibleModels" TEXT;

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "currentPalletId" TEXT,
ADD COLUMN     "rackLocation" TEXT;

-- CreateTable
CREATE TABLE "Pallet" (
    "id" TEXT NOT NULL,
    "palletNumber" TEXT NOT NULL,
    "purpose" "PalletPurpose" NOT NULL DEFAULT 'BGRADE',
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "locationCode" TEXT,
    "notes" TEXT,
    "isSealed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PalletItem" (
    "id" TEXT NOT NULL,
    "palletId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "PalletItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pallet_palletNumber_key" ON "Pallet"("palletNumber");

-- CreateIndex
CREATE INDEX "Pallet_purpose_idx" ON "Pallet"("purpose");

-- CreateIndex
CREATE INDEX "Pallet_isSealed_idx" ON "Pallet"("isSealed");

-- CreateIndex
CREATE INDEX "PalletItem_palletId_idx" ON "PalletItem"("palletId");

-- CreateIndex
CREATE INDEX "PalletItem_repairOrderId_idx" ON "PalletItem"("repairOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PalletItem_palletId_repairOrderId_key" ON "PalletItem"("palletId", "repairOrderId");

-- CreateIndex
CREATE INDEX "RepairOrder_currentPalletId_idx" ON "RepairOrder"("currentPalletId");

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_currentPalletId_fkey" FOREIGN KEY ("currentPalletId") REFERENCES "Pallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletItem" ADD CONSTRAINT "PalletItem_palletId_fkey" FOREIGN KEY ("palletId") REFERENCES "Pallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletItem" ADD CONSTRAINT "PalletItem_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletItem" ADD CONSTRAINT "PalletItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
