-- Admins manage colleges and organizations (docs/DOMAIN_RULES.md, "Administration").
ALTER TYPE "AuditAction" ADD VALUE 'organization_change';
ALTER TYPE "AuditAction" ADD VALUE 'college_change';

-- Carousel order. Existing rows keep today's name order.
ALTER TABLE "colleges" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "colleges" c SET "position" = o.rn
  FROM (SELECT id, row_number() OVER (ORDER BY name) - 1 AS rn FROM "colleges") o
  WHERE c.id = o.id;
UPDATE "organizations" g SET "position" = o.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY parent_id ORDER BY name) - 1 AS rn
    FROM "organizations"
  ) o
  WHERE g.id = o.id;

-- Deactivated: hidden from browsing, no uploads or new projects. Documents stay visible.
ALTER TABLE "organizations" ADD COLUMN "deactivated_at" TIMESTAMP(3);
