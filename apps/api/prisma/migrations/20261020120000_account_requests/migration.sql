-- Phase C (docs/DOMAIN_RULES.md, "Accounts"): the ISSC account asks the super admin for an
-- organization's account; the super admin creates it or declines with a reason.

-- CreateEnum
CREATE TYPE "AccountRequestStatus" AS ENUM ('requested', 'created', 'declined');

-- AlterEnum


ALTER TYPE "AuditAction" ADD VALUE 'account_request';
ALTER TYPE "AuditAction" ADD VALUE 'account_request_decline';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'account_request_declined';

-- CreateTable
CREATE TABLE "account_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "account_email" TEXT NOT NULL,
    "officer_name" TEXT NOT NULL,
    "officer_position" TEXT NOT NULL,
    "officer_email" TEXT NOT NULL,
    "note" TEXT,
    "status" "AccountRequestStatus" NOT NULL DEFAULT 'requested',
    "decline_reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_requests_organization_id_created_at_idx" ON "account_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "account_requests_status_created_at_idx" ON "account_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_created_account_id_fkey" FOREIGN KEY ("created_account_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One open request per organization.
CREATE UNIQUE INDEX "account_requests_one_open_per_org" ON "account_requests"("organization_id")
  WHERE "status" = 'requested';

-- A decision says who made it and when; a decline says why; a created request names the account.
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_decision_check" CHECK (
  ("status" = 'requested' AND "decided_at" IS NULL)
  OR ("status" = 'declined' AND "decided_at" IS NOT NULL AND "decline_reason" IS NOT NULL)
  OR ("status" = 'created' AND "decided_at" IS NOT NULL AND "created_account_id" IS NOT NULL)
);
