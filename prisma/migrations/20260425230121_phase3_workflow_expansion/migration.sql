-- CreateEnum
CREATE TYPE "RechargeOrigin" AS ENUM ('INBOUND_DIAGNOSIS', 'MECHANIC_REPAIR');

-- CreateEnum
CREATE TYPE "PartsRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'ORDERED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "MovementReason" ADD VALUE 'PARTS_REQUEST_AUTO';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "PhotoType" ADD VALUE 'CUSTOMER_REPORT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RepairStatus" ADD VALUE 'NEW';
ALTER TYPE "RepairStatus" ADD VALUE 'CS_TRIAGE';
ALTER TYPE "RepairStatus" ADD VALUE 'QUOTE_SENT';
ALTER TYPE "RepairStatus" ADD VALUE 'AWAITING_PICKUP';
ALTER TYPE "RepairStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "RepairStatus" ADD VALUE 'INBOUND_DIAGNOSIS';
ALTER TYPE "RepairStatus" ADD VALUE 'CS_RECHARGE';
ALTER TYPE "RepairStatus" ADD VALUE 'CUSTOMER_DECLINED';
ALTER TYPE "RepairStatus" ADD VALUE 'DELIVERED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScooterStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "ScooterStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "retailPrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "customerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "customerReportedAt" TIMESTAMP(3),
ADD COLUMN     "expectedArrivalDate" TIMESTAMP(3),
ADD COLUMN     "quoteAmount" DECIMAL(10,2),
ADD COLUMN     "quoteApprovedAt" TIMESTAMP(3),
ADD COLUMN     "quotedAt" TIMESTAMP(3),
ADD COLUMN     "rechargeAmount" DECIMAL(10,2),
ADD COLUMN     "rechargeOrigin" "RechargeOrigin",
ADD COLUMN     "rechargeReason" TEXT,
ADD COLUMN     "rechargeRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rechargeResolvedAt" TIMESTAMP(3),
ADD COLUMN     "returnToStatus" "RepairStatus",
ADD COLUMN     "trackingNumber" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "caseId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartsRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "PartsRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "PartsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_caseId_idx" ON "Notification"("caseId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "PartsRequest_caseId_idx" ON "PartsRequest"("caseId");

-- CreateIndex
CREATE INDEX "PartsRequest_partId_idx" ON "PartsRequest"("partId");

-- CreateIndex
CREATE INDEX "PartsRequest_status_idx" ON "PartsRequest"("status");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepairOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
