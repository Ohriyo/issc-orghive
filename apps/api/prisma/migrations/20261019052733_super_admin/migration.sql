-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('NONE', 'SUPER_ADMIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'super_admin_create';
ALTER TYPE "AuditAction" ADD VALUE 'super_admin_mfa_reset';
ALTER TYPE "AuditAction" ADD VALUE 'mfa_enroll';
ALTER TYPE "AuditAction" ADD VALUE 'mfa_failed';
ALTER TYPE "AuditAction" ADD VALUE 'mfa_recovery_used';
ALTER TYPE "AuditAction" ADD VALUE 'recovery_codes_regenerate';
ALTER TYPE "AuditAction" ADD VALUE 'step_up';
ALTER TYPE "AuditAction" ADD VALUE 'system_role_change';
ALTER TYPE "AuditAction" ADD VALUE 'user_deactivate';
ALTER TYPE "AuditAction" ADD VALUE 'user_reactivate';
ALTER TYPE "AuditAction" ADD VALUE 'super_admin_lockout';
ALTER TYPE "AuditAction" ADD VALUE 'system_view';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_last_time_step" INTEGER,
ADD COLUMN     "mfa_secret" TEXT,
ADD COLUMN     "system_role" "SystemRole" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "users_system_role_idx" ON "users"("system_role");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
