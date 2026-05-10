-- Audit log + transactional outbox foundation.
-- Additive only: no DROP, no RENAME, no edits to existing tables.
-- See docs/adr/0001-audit-log-and-outbox.md for the rationale.

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT,
    "actor_role" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB,
    "reason" TEXT,
    "request_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entity_occurred_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at" DESC);
CREATE INDEX "audit_log_actor_occurred_idx"  ON "audit_log"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "audit_log_occurred_idx"        ON "audit_log"("occurred_at" DESC);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (uniqueness on idempotency_key + dispatch / debug indexes)
CREATE UNIQUE INDEX "outbox_event_idempotency_key_key" ON "outbox_event"("idempotency_key");
CREATE INDEX        "outbox_event_dispatch_idx"        ON "outbox_event"("processed_at", "available_at");
CREATE INDEX        "outbox_event_aggregate_idx"       ON "outbox_event"("aggregate_type", "aggregate_id");
