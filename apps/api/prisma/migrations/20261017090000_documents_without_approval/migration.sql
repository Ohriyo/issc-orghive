-- Documents are no longer reviewed or approved (docs/PROJECT_WORKFLOW_SPEC.md, section 0).
-- Who can see a document is decided by its visibility alone, so existing rows are mapped
-- without exposing anything that was never approved:
--   approved                         -> available, visibility kept
--   draft, pending, rejected         -> private; status from the current file's scan
--   archived (from approved)         -> archived, visibility kept
--   archived (from anything else, or
--     archived before that was recorded) -> archived, private
-- The new status follows the current file: clean -> available, still being scanned ->
-- scanning, refused -> quarantined. A row without a file stays available (to its viewers).

-- The counts this migration acts on, for the deploy log.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT status::text AS status, visibility::text AS visibility, count(*) AS n
    FROM "documents" GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'before: % / % = %', r.status, r.visibility, r.n;
  END LOOP;
END $$;

-- 1. Visibility, decided from the old status.
UPDATE "documents"
SET "visibility" = 'private'
WHERE "status" IN ('draft', 'pending', 'rejected')
   OR ("status" = 'archived' AND "archived_from_status" IS DISTINCT FROM 'approved');

-- 2. The new lifecycle.
CREATE TYPE "DocumentStatus_new" AS ENUM ('scanning', 'available', 'quarantined', 'archived');

ALTER TABLE "documents" ADD COLUMN "status_new" "DocumentStatus_new";

UPDATE "documents" AS d
SET "status_new" = (
  CASE
    WHEN d."status" = 'archived' THEN 'archived'
    WHEN v."scan_status" IN ('infected', 'invalid') THEN 'quarantined'
    WHEN v."scan_status" = 'pending' THEN 'scanning'
    ELSE 'available'
  END
)::"DocumentStatus_new"
FROM "documents" AS src
LEFT JOIN "document_versions" AS v ON v."id" = src."current_version_id"
WHERE src."id" = d."id";

DROP INDEX "documents_status_idx";
ALTER TABLE "documents" DROP COLUMN "status";
ALTER TABLE "documents" DROP COLUMN "archived_from_status";
ALTER TABLE "documents" DROP COLUMN "submitted_at";
DROP TYPE "DocumentStatus";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
ALTER TABLE "documents" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "documents" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'scanning';
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- 3. New uploads default to public (the organization chooses on upload).
ALTER TABLE "documents" ALTER COLUMN "visibility" SET DEFAULT 'public';

-- 4. Approvals are gone. Their audit entries (approve/reject) stay: the log is append-only.
DROP TABLE "approvals";
DROP TYPE "ApprovalDecision";

-- 5. Officers changing who can see a document is audited.
ALTER TYPE "AuditAction" ADD VALUE 'visibility_change';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT status::text AS status, visibility::text AS visibility, count(*) AS n
    FROM "documents" GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'after: % / % = %', r.status, r.visibility, r.n;
  END LOOP;
END $$;
