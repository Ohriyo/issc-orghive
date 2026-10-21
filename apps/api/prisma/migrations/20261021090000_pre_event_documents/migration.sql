-- Pre-event documents (docs/PROJECT_WORKFLOW_SPEC.md, section 2B, 2026-10-21): the
-- Communication Letter and the Attendance Sheet, ticked per project like the NOM and MOM,
-- and optional other pre-event documents. Letters and other documents hold several files.
ALTER TYPE "ProjectTaskType" ADD VALUE IF NOT EXISTS 'COMMUNICATION_LETTER' BEFORE 'ACR';
ALTER TYPE "ProjectTaskType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_SHEET' BEFORE 'ACR';
ALTER TYPE "ProjectTaskType" ADD VALUE IF NOT EXISTS 'OTHER_PRE_EVENT' BEFORE 'ACR';

-- Existing projects need neither, so their checklists do not change.
ALTER TABLE "projects"
  ADD COLUMN "communication_letter_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attendance_sheet_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "project_task_files" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_task_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_task_files_document_id_key" ON "project_task_files"("document_id");
CREATE INDEX "project_task_files_task_id_created_at_idx" ON "project_task_files"("task_id", "created_at");

ALTER TABLE "project_task_files" ADD CONSTRAINT "project_task_files_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_files" ADD CONSTRAINT "project_task_files_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The document types these files are archived as (PROJECT_TASK_DOCUMENT_TYPES).
INSERT INTO "document_types" ("id", "slug", "name")
VALUES
  (gen_random_uuid(), 'communication-letter', 'Communication letter'),
  (gen_random_uuid(), 'attendance-sheet', 'Attendance sheet'),
  (gen_random_uuid(), 'other-pre-event-document', 'Other pre-event document')
ON CONFLICT ("slug") DO NOTHING;
