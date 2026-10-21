-- Demo data (pnpm --filter api db:seed:demo): every demo row is flagged so db:unseed:demo can
-- remove exactly those, and the API can refuse to start in production while any remains.
-- The partial indexes keep those checks cheap: they only ever hold demo rows.

ALTER TYPE "AuditAction" ADD VALUE 'demo_data_remove';

ALTER TABLE "organizations" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "audit_logs" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "announcements" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "document_versions" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "project_tasks" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "project_task_files" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_freezes" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appeals" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notifications" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "financial_figures" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leaderboard_snapshots" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "organizations_is_demo_idx" ON "organizations" ("id") WHERE "is_demo";
CREATE INDEX "users_is_demo_idx" ON "users" ("id") WHERE "is_demo";
CREATE INDEX "audit_logs_is_demo_idx" ON "audit_logs" ("id") WHERE "is_demo";
CREATE INDEX "announcements_is_demo_idx" ON "announcements" ("id") WHERE "is_demo";
CREATE INDEX "documents_is_demo_idx" ON "documents" ("id") WHERE "is_demo";
CREATE INDEX "document_versions_is_demo_idx" ON "document_versions" ("id") WHERE "is_demo";
CREATE INDEX "projects_is_demo_idx" ON "projects" ("id") WHERE "is_demo";
CREATE INDEX "project_tasks_is_demo_idx" ON "project_tasks" ("id") WHERE "is_demo";
CREATE INDEX "project_task_files_is_demo_idx" ON "project_task_files" ("id") WHERE "is_demo";
CREATE INDEX "org_freezes_is_demo_idx" ON "org_freezes" ("id") WHERE "is_demo";
CREATE INDEX "appeals_is_demo_idx" ON "appeals" ("id") WHERE "is_demo";
CREATE INDEX "notifications_is_demo_idx" ON "notifications" ("id") WHERE "is_demo";
CREATE INDEX "financial_figures_is_demo_idx" ON "financial_figures" ("id") WHERE "is_demo";
CREATE INDEX "leaderboard_snapshots_is_demo_idx" ON "leaderboard_snapshots" ("id") WHERE "is_demo";
