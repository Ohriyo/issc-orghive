-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'semester_dates_change';
ALTER TYPE "AuditAction" ADD VALUE 'leaderboard_disqualify';
ALTER TYPE "AuditAction" ADD VALUE 'leaderboard_disqualification_lift';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'leaderboard_penalty';

-- AlterTable
ALTER TABLE "leaderboard_snapshots" ADD COLUMN     "is_final" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "late_points" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "semester_dates" (
    "id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semester_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_disqualifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "reason" TEXT NOT NULL,
    "acting_as" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    "lift_reason" TEXT,
    "lift_acting_as" TEXT,
    "lifted_by_id" UUID,

    CONSTRAINT "leaderboard_disqualifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "semester_dates_academic_year_semester_key" ON "semester_dates"("academic_year", "semester");

-- CreateIndex
CREATE INDEX "leaderboard_disqualifications_academic_year_semester_idx" ON "leaderboard_disqualifications"("academic_year", "semester");

-- AddForeignKey
ALTER TABLE "semester_dates" ADD CONSTRAINT "semester_dates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_disqualifications" ADD CONSTRAINT "leaderboard_disqualifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_disqualifications" ADD CONSTRAINT "leaderboard_disqualifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_disqualifications" ADD CONSTRAINT "leaderboard_disqualifications_lifted_by_id_fkey" FOREIGN KEY ("lifted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One final board per semester and type (spec 5B); a second finisher's rows are skipped.
CREATE UNIQUE INDEX "leaderboard_snapshots_one_final" ON "leaderboard_snapshots" ("academic_year", "semester", "type") WHERE "is_final";

-- One standing disqualification per organization and semester (spec 5B); lifted ones stay as the record.
CREATE UNIQUE INDEX "leaderboard_disqualifications_one_standing" ON "leaderboard_disqualifications" ("organization_id", "academic_year", "semester") WHERE "lifted_at" IS NULL;
