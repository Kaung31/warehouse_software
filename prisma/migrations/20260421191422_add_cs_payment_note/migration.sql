-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "csPaymentNote" TEXT,
ADD COLUMN     "customerPrepaid" BOOLEAN NOT NULL DEFAULT false;
