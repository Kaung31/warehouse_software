ALTER TABLE "RepairOrder" ADD COLUMN "warrantyConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RepairOrder" ADD COLUMN "source" TEXT;
ALTER TABLE "Scooter" ADD COLUMN "totalMileage" INTEGER;
ALTER TABLE "WarehouseLocation" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 0;
