-- CreateEnum
CREATE TYPE "IntegrityCheckKind" AS ENUM ('format', 'task_code', 'blank', 'exact_duplicate', 'near_duplicate', 'keywords', 'financial_totals');

-- CreateEnum
CREATE TYPE "IntegrityResult" AS ENUM ('pass', 'warn', 'fail');

-- CreateEnum
CREATE TYPE "TaskCodeMatch" AS ENUM ('qr', 'typed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScanStatus" ADD VALUE 'checking';
ALTER TYPE "ScanStatus" ADD VALUE 'rejected';

-- CreateTable
CREATE TABLE "task_codes" (
    "id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "task_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "label" VARCHAR(80),
    "task_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrity_checks" (
    "id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version_id" UUID NOT NULL,
    "kind" "IntegrityCheckKind" NOT NULL,
    "result" "IntegrityResult" NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrity_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version_integrity" (
    "version_id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "typed_code" VARCHAR(16),
    "task_code_id" UUID,
    "matched_by" "TaskCodeMatch",
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3),
    "warnings_cleared_at" TIMESTAMP(3),
    "warnings_cleared_by_id" UUID,
    "warnings_cleared_acting_as" VARCHAR(80),
    "warnings_cleared_note" VARCHAR(500),
    "flagged_at" TIMESTAMP(3),
    "flagged_by_id" UUID,
    "flagged_acting_as" VARCHAR(80),
    "flag_reason" VARCHAR(500),

    CONSTRAINT "version_integrity_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "page_hashes" (
    "version_id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "page" INTEGER NOT NULL,
    "hash" BIGINT NOT NULL,

    CONSTRAINT "page_hashes_pkey" PRIMARY KEY ("version_id","page")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_codes_code_key" ON "task_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "task_codes_task_file_id_key" ON "task_codes"("task_file_id");

-- CreateIndex
CREATE INDEX "task_codes_task_id_idx" ON "task_codes"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrity_checks_version_id_kind_key" ON "integrity_checks"("version_id", "kind");

-- AddForeignKey
ALTER TABLE "task_codes" ADD CONSTRAINT "task_codes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_codes" ADD CONSTRAINT "task_codes_task_file_id_fkey" FOREIGN KEY ("task_file_id") REFERENCES "project_task_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrity_checks" ADD CONSTRAINT "integrity_checks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_task_code_id_fkey" FOREIGN KEY ("task_code_id") REFERENCES "task_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_warnings_cleared_by_id_fkey" FOREIGN KEY ("warnings_cleared_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_flagged_by_id_fkey" FOREIGN KEY ("flagged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_hashes" ADD CONSTRAINT "page_hashes_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "document_versions_sha256_idx" ON "document_versions"("sha256");

-- A flag names who flagged and why; cleared warnings name who cleared them (all or none).
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_flag_complete" CHECK (
  ("flagged_at" IS NULL AND "flagged_by_id" IS NULL AND "flagged_acting_as" IS NULL AND "flag_reason" IS NULL)
  OR ("flagged_at" IS NOT NULL AND "flagged_by_id" IS NOT NULL AND "flagged_acting_as" IS NOT NULL AND "flag_reason" IS NOT NULL)
);
ALTER TABLE "version_integrity" ADD CONSTRAINT "version_integrity_cleared_complete" CHECK (
  ("warnings_cleared_at" IS NULL AND "warnings_cleared_by_id" IS NULL AND "warnings_cleared_acting_as" IS NULL)
  OR ("warnings_cleared_at" IS NOT NULL AND "warnings_cleared_by_id" IS NOT NULL AND "warnings_cleared_acting_as" IS NOT NULL)
);

-- Existing task files predate the checks (docs/PROJECT_WORKFLOW_SPEC.md, section 6): they
-- stay complete for the workflow but are "legacy, unverified" until re-uploaded on a template.
INSERT INTO "version_integrity" ("version_id", "is_demo", "legacy")
SELECT v."id", v."is_demo", true
FROM "document_versions" v
WHERE v."scan_status" = 'clean'
  AND (
    EXISTS (
      SELECT 1 FROM "project_tasks" t
      WHERE t."document_id" = v."document_id" AND t."type" <> 'OTHER_PRE_EVENT'
    )
    OR EXISTS (
      SELECT 1 FROM "project_task_files" f
      JOIN "project_tasks" t ON t."id" = f."task_id"
      WHERE f."document_id" = v."document_id" AND t."type" = 'COMMUNICATION_LETTER'
    )
  );
