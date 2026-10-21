-- View-only previews: watermarked page images for every clean version. Existing versions
-- start pending; `pnpm --filter api pages:backfill` queues them for rendering.
CREATE TYPE "PreviewStatus" AS ENUM ('pending', 'ready', 'failed');

ALTER TABLE "document_versions"
  ADD COLUMN "preview_status" "PreviewStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "preview_pages" JSONB,
  ADD COLUMN "page_count" INTEGER;

-- The backfill and the stale sweep look for clean versions still waiting for pages.
CREATE INDEX "document_versions_preview_pending_idx"
  ON "document_versions" ("created_at")
  WHERE "scan_status" = 'clean' AND "preview_status" = 'pending';
