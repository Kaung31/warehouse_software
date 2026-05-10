-- CreateTable
CREATE TABLE "RepairGuide" (
    "id" TEXT NOT NULL,
    "scooterModel" TEXT NOT NULL,
    "brand" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairGuide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairGuide_scooterModel_idx" ON "RepairGuide"("scooterModel");

-- CreateIndex
CREATE INDEX "RepairGuide_brand_idx" ON "RepairGuide"("brand");

-- CreateIndex
CREATE INDEX "RepairGuide_category_idx" ON "RepairGuide"("category");
