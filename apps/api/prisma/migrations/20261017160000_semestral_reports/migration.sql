-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('queued', 'generating', 'ready', 'failed');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'report_generate';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'report_ready';

-- CreateTable
CREATE TABLE "semestral_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requested_by_id" UUID NOT NULL,
    "document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "semestral_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "semestral_reports_document_id_key" ON "semestral_reports"("document_id");

-- CreateIndex
CREATE INDEX "semestral_reports_organization_id_created_at_idx" ON "semestral_reports"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "semestral_reports" ADD CONSTRAINT "semestral_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semestral_reports" ADD CONSTRAINT "semestral_reports_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semestral_reports" ADD CONSTRAINT "semestral_reports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One report per organization and semester runs at a time (queued or generating); a
-- second request while one runs is refused instead of doing the work twice.
CREATE UNIQUE INDEX "semestral_reports_one_running" ON "semestral_reports"("organization_id", "academic_year", "semester")
  WHERE "status" IN ('queued', 'generating');
ALTER TABLE "semestral_reports" ADD CONSTRAINT "semestral_reports_progress_range"
  CHECK ("progress" BETWEEN 0 AND 100);
-- A ready report has its document; a failed one says why.
ALTER TABLE "semestral_reports" ADD CONSTRAINT "semestral_reports_outcome"
  CHECK (
    ("status" <> 'ready' OR "document_id" IS NOT NULL)
    AND ("status" <> 'failed' OR "error" IS NOT NULL)
  );

-- The document type generated reports are filed as (REPORT_DOCUMENT_TYPE in packages/shared).
INSERT INTO "document_types" ("id", "slug", "name")
VALUES (gen_random_uuid(), 'semestral-end-report', 'Semestral End Report')
ON CONFLICT ("slug") DO NOTHING;
