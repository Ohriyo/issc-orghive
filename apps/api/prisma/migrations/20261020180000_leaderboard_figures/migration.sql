-- The leaderboard's data (docs/PROJECT_WORKFLOW_SPEC.md, section 5): Financial Report
-- figures in centavos, system settings (the late-point value) and standings snapshots.

ALTER TYPE "AuditAction" ADD VALUE 'financial_figures_change';
ALTER TYPE "AuditAction" ADD VALUE 'financial_figures_flag';
ALTER TYPE "AuditAction" ADD VALUE 'financial_figures_unflag';
ALTER TYPE "AuditAction" ADD VALUE 'system_setting_change';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'figures_review';

-- CreateTable
CREATE TABLE "financial_figures" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "income_centavos" INTEGER NOT NULL,
    "expenses_centavos" INTEGER NOT NULL,
    "flagged_at" TIMESTAMP(3),
    "flagged_by_id" UUID,
    "flag_remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_figures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" "Semester" NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "rows" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_figures_project_id_key" ON "financial_figures"("project_id");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_academic_year_semester_type_computed__idx" ON "leaderboard_snapshots"("academic_year", "semester", "type", "computed_at");

-- AddForeignKey
ALTER TABLE "financial_figures" ADD CONSTRAINT "financial_figures_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_figures" ADD CONSTRAINT "financial_figures_flagged_by_id_fkey" FOREIGN KEY ("flagged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Figures are whole centavos from 0 to ₱10,000,000.00 (MAX_FIGURE_CENTAVOS in packages/shared).
ALTER TABLE "financial_figures" ADD CONSTRAINT "financial_figures_amounts_range"
  CHECK ("income_centavos" BETWEEN 0 AND 1000000000 AND "expenses_centavos" BETWEEN 0 AND 1000000000);

-- Under review: the time and remark are set together, or neither (the flagger may be deleted).
ALTER TABLE "financial_figures" ADD CONSTRAINT "financial_figures_flag_complete"
  CHECK (("flagged_at" IS NULL) = ("flag_remark" IS NULL));
