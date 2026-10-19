-- CreateEnum
CREATE TYPE "AppealType" AS ENUM ('PROJECT_BLOCK', 'ORG_FREEZE');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('deadline_soon', 'deadline_missed', 'appeal_submitted', 'appeal_decided');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'project_block';
ALTER TYPE "AuditAction" ADD VALUE 'project_unblock';
ALTER TYPE "AuditAction" ADD VALUE 'org_freeze';
ALTER TYPE "AuditAction" ADD VALUE 'org_unfreeze';
ALTER TYPE "AuditAction" ADD VALUE 'appeal_submit';
ALTER TYPE "AuditAction" ADD VALUE 'appeal_attachment_view';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "post_event_due_override" TIMESTAMP(3),
ADD COLUMN     "proposal_due_override" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "org_freezes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reports" "ProjectTaskType"[],
    "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),

    CONSTRAINT "org_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" UUID NOT NULL,
    "type" "AppealType" NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "freeze_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'pending',
    "submitted_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "remarks" TEXT,
    "new_due_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeal_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "appeal_id" UUID,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeal_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_freezes_organization_id_lifted_at_idx" ON "org_freezes"("organization_id", "lifted_at");

-- CreateIndex
CREATE INDEX "appeals_organization_id_created_at_idx" ON "appeals"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "appeals_project_id_created_at_idx" ON "appeals"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "appeals_status_idx" ON "appeals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "appeal_attachments_storage_key_key" ON "appeal_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "appeal_attachments_appeal_id_idx" ON "appeal_attachments"("appeal_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "org_freezes" ADD CONSTRAINT "org_freezes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_freezes" ADD CONSTRAINT "org_freezes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_freeze_id_fkey" FOREIGN KEY ("freeze_id") REFERENCES "org_freezes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeal_attachments" ADD CONSTRAINT "appeal_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeal_attachments" ADD CONSTRAINT "appeal_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeal_attachments" ADD CONSTRAINT "appeal_attachments_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "appeals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules Prisma cannot express (docs/PROJECT_WORKFLOW_SPEC.md, section 3).

-- At most one open freeze per project: the hourly job and the check on read may race, and
-- the loser's insert is skipped (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "org_freezes_one_open_per_project" ON "org_freezes"("project_id")
  WHERE "lifted_at" IS NULL;
ALTER TABLE "org_freezes" ADD CONSTRAINT "org_freezes_reports_present"
  CHECK (cardinality("reports") > 0);

-- One pending appeal per blocked project, and one per freeze.
CREATE UNIQUE INDEX "appeals_one_pending_block" ON "appeals"("project_id")
  WHERE "status" = 'pending' AND "type" = 'PROJECT_BLOCK';
CREATE UNIQUE INDEX "appeals_one_pending_freeze" ON "appeals"("freeze_id")
  WHERE "status" = 'pending';

-- A freeze appeal names its freeze; a block appeal does not.
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_freeze_matches_type"
  CHECK (("type" = 'ORG_FREEZE') = ("freeze_id" IS NOT NULL));
-- A decision is complete: who and when; approvals set a due date, rejections explain.
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_complete"
  CHECK (
    ("status" = 'pending' AND "decided_at" IS NULL AND "decided_by_id" IS NULL)
    OR ("status" = 'approved' AND "decided_at" IS NOT NULL AND "new_due_at" IS NOT NULL)
    OR ("status" = 'rejected' AND "decided_at" IS NOT NULL AND "remarks" IS NOT NULL)
  );
