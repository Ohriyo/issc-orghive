-- CreateTable
CREATE TABLE "system_metrics" (
    "id" UUID NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "client_errors" INTEGER NOT NULL DEFAULT 0,
    "server_errors" INTEGER NOT NULL DEFAULT 0,
    "p50_ms" DOUBLE PRECISION,
    "p95_ms" DOUBLE PRECISION,
    "p99_ms" DOUBLE PRECISION,
    "event_loop_lag_ms" DOUBLE PRECISION,
    "rss_bytes" BIGINT,
    "cpu_percent" DOUBLE PRECISION,
    "cache_hits" INTEGER NOT NULL DEFAULT 0,
    "cache_misses" INTEGER NOT NULL DEFAULT 0,
    "queue_waiting" INTEGER,
    "queue_failed" INTEGER,
    "storage_bytes" BIGINT,
    "database_bytes" BIGINT,
    "routes" JSONB,
    "slow_queries" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_metrics_minute_idx" ON "system_metrics"("minute");

-- CreateIndex
CREATE UNIQUE INDEX "system_metrics_minute_source_key" ON "system_metrics"("minute", "source");

-- CreateIndex
CREATE INDEX "system_alerts_kind_opened_at_idx" ON "system_alerts"("kind", "opened_at");

-- One open alert per kind: API instances racing to open the same alert insert one row
-- (the others hit ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "system_alerts_one_open_per_kind" ON "system_alerts"("kind") WHERE "resolved_at" IS NULL;
