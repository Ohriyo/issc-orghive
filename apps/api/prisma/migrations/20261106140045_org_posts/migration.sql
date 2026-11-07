-- CreateEnum
CREATE TYPE "OrgPostType" AS ENUM ('UPDATE', 'HIGHLIGHT');

-- CreateEnum
CREATE TYPE "OrgPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'HIDDEN');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'post_change';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'post_hidden';

-- CreateTable
CREATE TABLE "org_posts" (
    "id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "type" "OrgPostType" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "cover_key" TEXT,
    "cover_widths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "cover_alt" TEXT,
    "gallery" JSONB NOT NULL DEFAULT '[]',
    "external_link" TEXT,
    "event_date" DATE,
    "status" "OrgPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pin_order" INTEGER,
    "acting_as" TEXT NOT NULL,
    "hidden_at" TIMESTAMP(3),
    "hidden_reason" TEXT,
    "hidden_by_org_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_posts_organization_id_status_published_at_idx" ON "org_posts"("organization_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "org_posts_status_publish_at_idx" ON "org_posts"("status", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "org_posts_organization_id_slug_key" ON "org_posts"("organization_id", "slug");

-- AddForeignKey
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_hidden_by_org_id_fkey" FOREIGN KEY ("hidden_by_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rules the database keeps as well (docs/DOMAIN_RULES.md, "Organization posts"):
-- only highlights are pinned, a pinned post has a place 1–6, and no two share one.
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_pin_check" CHECK (
  ("pinned" = false AND "pin_order" IS NULL)
  OR ("pinned" = true AND "type" = 'HIGHLIGHT' AND "pin_order" BETWEEN 1 AND 6)
);
CREATE UNIQUE INDEX "org_posts_pin_order_key" ON "org_posts"("organization_id", "pin_order")
  WHERE "pinned" = true AND "deleted_at" IS NULL;

-- A scheduled post knows when; a hidden post says why.
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_schedule_check" CHECK (
  "status" <> 'SCHEDULED' OR "publish_at" IS NOT NULL
);
ALTER TABLE "org_posts" ADD CONSTRAINT "org_posts_hidden_check" CHECK (
  "status" <> 'HIDDEN' OR ("hidden_at" IS NOT NULL AND "hidden_reason" IS NOT NULL)
);
