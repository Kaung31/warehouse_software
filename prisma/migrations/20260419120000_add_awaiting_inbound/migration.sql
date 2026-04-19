-- Add AWAITING_INBOUND to RepairStatus enum
-- This is the initial status when CS creates a case before the scooter physically arrives.
ALTER TYPE "RepairStatus" ADD VALUE 'AWAITING_INBOUND';
