-- Shared organization accounts (docs/DOMAIN_RULES.md, "Accounts", chosen 2026-10-19).
-- Every organization, the ISSC included, has one shared account (users.organization_id).
-- Per-person memberships, roles (officer, adviser, admin) and heads are gone; the officer
-- in charge of an account is kept per term in officer_terms.
--
-- Existing personal accounts are NOT mapped to organizations: one person could hold several
-- memberships, so there is no safe automatic choice. They keep signing in but act for no
-- organization until a super admin assigns accounts (dev databases are reset and reseeded).

-- Visibility: public | governing | private. Old `members` documents become private and are
-- flagged as test data for the super admin's "Delete test data" (never deleted here).
ALTER TABLE "documents" ADD COLUMN "is_test_data" BOOLEAN NOT NULL DEFAULT false;
UPDATE "documents" SET "is_test_data" = true WHERE "visibility" = 'members';

CREATE TYPE "DocumentVisibility_new" AS ENUM ('public', 'governing', 'private');
ALTER TABLE "documents" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "visibility" TYPE "DocumentVisibility_new"
  USING (CASE WHEN "visibility"::text = 'members' THEN 'private' ELSE "visibility"::text END)::"DocumentVisibility_new";
ALTER TYPE "DocumentVisibility" RENAME TO "DocumentVisibility_old";
ALTER TYPE "DocumentVisibility_new" RENAME TO "DocumentVisibility";
DROP TYPE "DocumentVisibility_old";
ALTER TABLE "documents" ALTER COLUMN "visibility" SET DEFAULT 'public';

-- Sessions remember where they came from (active sessions on the user detail page).
ALTER TABLE "refresh_tokens" ADD COLUMN "ip" TEXT;

-- The account's organization, lock and last sign-in.
ALTER TABLE "users" ADD COLUMN "organization_id" UUID,
ADD COLUMN "locked_at" TIMESTAMP(3),
ADD COLUMN "lock_reason" TEXT,
ADD COLUMN "last_login_at" TIMESTAMP(3);
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- At most one active account per organization. A deactivated account keeps its link (for
-- history) and frees the organization for a new one.
CREATE UNIQUE INDEX "users_one_active_account_per_org" ON "users"("organization_id")
  WHERE "organization_id" IS NOT NULL AND "disabled_at" IS NULL;
-- Only the developer's SUPER_ADMIN account belongs to no organization.
ALTER TABLE "users" ADD CONSTRAINT "users_super_admin_has_no_org"
  CHECK ("system_role" = 'NONE' OR "organization_id" IS NULL);

-- Officer-in-charge per term.
CREATE TABLE "officer_terms" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "officer_name" TEXT NOT NULL,
    "officer_position" TEXT NOT NULL,
    "officer_email" TEXT NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "officer_terms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "officer_terms_term_check" CHECK ("term_end" IS NULL OR "term_end" >= "term_start")
);
CREATE INDEX "officer_terms_user_id_idx" ON "officer_terms"("user_id");
CREATE INDEX "officer_terms_organization_id_idx" ON "officer_terms"("organization_id");
-- One open term per account.
CREATE UNIQUE INDEX "officer_terms_one_open_per_user" ON "officer_terms"("user_id") WHERE "ended_at" IS NULL;
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_user_id_fkey" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_organization_id_fkey" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-person memberships and roles are gone.
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_organization_id_fkey";
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_fkey";
DROP TABLE "memberships";
DROP TYPE "MembershipRole";
