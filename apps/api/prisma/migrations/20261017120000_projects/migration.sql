-- Projects and their milestone checklist (docs/PROJECT_WORKFLOW_SPEC.md, sections 2A and 2B).
-- A task's file is an ordinary Paperworks document: nothing here reviews or approves it.
-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'blocked', 'completed');

-- CreateEnum
CREATE TYPE "ProjectTaskType" AS ENUM ('PROPOSAL', 'NOM', 'MOM', 'ACR', 'FINANCIAL_REPORT');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('locked', 'open', 'submitted');

-- AlterEnum


ALTER TYPE "AuditAction" ADD VALUE 'project_create';
ALTER TYPE "AuditAction" ADD VALUE 'project_update';

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "beneficiaries" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "proposal_due_at" TIMESTAMP(3) NOT NULL,
    "post_event_due_at" TIMESTAMP(3) NOT NULL,
    "nom_required" BOOLEAN NOT NULL DEFAULT false,
    "mom_required" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" "ProjectTaskType" NOT NULL,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'locked',
    "due_at" TIMESTAMP(3),
    "document_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE INDEX "projects_organization_id_target_date_idx" ON "projects"("organization_id", "target_date");

-- CreateIndex
CREATE UNIQUE INDEX "project_tasks_document_id_key" ON "project_tasks"("document_id");

-- CreateIndex
CREATE INDEX "project_tasks_status_due_at_idx" ON "project_tasks"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_tasks_project_id_type_key" ON "project_tasks"("project_id", "type");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The document types task files are archived as (PROJECT_TASK_DOCUMENT_TYPES in packages/shared).
INSERT INTO "document_types" ("id", "slug", "name")
VALUES
  (gen_random_uuid(), 'project-proposal', 'Project proposal'),
  (gen_random_uuid(), 'notice-of-meeting', 'Notice of meeting'),
  (gen_random_uuid(), 'minutes-of-meeting', 'Minutes of meeting'),
  (gen_random_uuid(), 'activity-completion-report', 'Activity completion report'),
  (gen_random_uuid(), 'financial-report', 'Financial report')
ON CONFLICT ("slug") DO NOTHING;
