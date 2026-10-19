-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('public', 'members', 'private');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'admin_override';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "visibility" "DocumentVisibility" NOT NULL DEFAULT 'members';
