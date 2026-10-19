-- Phase B (docs/DOMAIN_RULES.md, "Accounts"): the super admin manages organization accounts.
-- Temporary passwords are stored only as hashes; one AES-256-GCM copy waits for the ISSC
-- account's one-time Reveal and is erased once revealed or expired. sessions_revoked_at ends
-- live access tokens after a reset, a forced sign-out, a lock or a deactivation.

-- CreateEnum
CREATE TYPE "RevealPurpose" AS ENUM ('account_created', 'password_reset', 'bulk_created', 'end_of_term');

-- AlterEnum


ALTER TYPE "AuditAction" ADD VALUE 'account_create';
ALTER TYPE "AuditAction" ADD VALUE 'account_update';
ALTER TYPE "AuditAction" ADD VALUE 'account_lock';
ALTER TYPE "AuditAction" ADD VALUE 'account_unlock';
ALTER TYPE "AuditAction" ADD VALUE 'password_reset_issued';
ALTER TYPE "AuditAction" ADD VALUE 'sessions_revoke';
ALTER TYPE "AuditAction" ADD VALUE 'password_reveal';
ALTER TYPE "AuditAction" ADD VALUE 'support_rescan';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'password_reveal';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "reveal_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessions_revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "password_reveals" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "purpose" "RevealPurpose" NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "sealed" TEXT,
    "issued_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "password_reveals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reveals_recipient_id_created_at_idx" ON "password_reveals"("recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "password_reveals_expires_at_idx" ON "password_reveals"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_reveal_id_key" ON "notifications"("reveal_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reveal_id_fkey" FOREIGN KEY ("reveal_id") REFERENCES "password_reveals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reveals" ADD CONSTRAINT "password_reveals_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reveals" ADD CONSTRAINT "password_reveals_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A revealed copy is never kept.
ALTER TABLE "password_reveals" ADD CONSTRAINT "password_reveals_sealed_once_check"
  CHECK ("sealed" IS NULL OR "revealed_at" IS NULL);
ALTER TABLE "password_reveals" ADD CONSTRAINT "password_reveals_entry_count_check"
  CHECK ("entry_count" >= 1);
