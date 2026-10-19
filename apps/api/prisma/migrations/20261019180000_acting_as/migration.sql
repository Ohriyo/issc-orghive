-- "Acting as" (docs/DOMAIN_RULES.md, "Accounts"): an organization's officers share one
-- account, so uploads, archives and deletions name the officer who acted. The API requires
-- 2-80 trimmed characters; older rows and files Orghive made have none.

-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN "acting_as" VARCHAR(80);
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_acting_as_check"
  CHECK ("acting_as" IS NULL OR char_length(btrim("acting_as")) >= 2);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "acting_as" VARCHAR(80);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_acting_as_check"
  CHECK ("acting_as" IS NULL OR char_length(btrim("acting_as")) >= 2);
