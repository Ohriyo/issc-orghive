-- Authentication: forced first password change, absolute session cap, reset tokens.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'password_reset_requested';
ALTER TYPE "AuditAction" ADD VALUE 'password_reset';
ALTER TYPE "AuditAction" ADD VALUE 'password_change';
ALTER TYPE "AuditAction" ADD VALUE 'token_reuse';

-- AlterTable
-- Existing tokens get a session end equal to their own expiry, so none is extended.
ALTER TABLE "refresh_tokens" ADD COLUMN     "session_expires_at" TIMESTAMP(3);
UPDATE "refresh_tokens" SET "session_expires_at" = "expires_at";
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_expires_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
