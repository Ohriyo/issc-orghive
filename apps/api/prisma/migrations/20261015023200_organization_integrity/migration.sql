-- The three levels, enforced by the database (CLAUDE.md):
-- the ISSC has no parent and no college; every CSC and SBO has both.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_hierarchy_check" CHECK (
    ("type" = 'ISSC' AND "parent_id" IS NULL AND "college_id" IS NULL)
    OR ("type" <> 'ISSC' AND "parent_id" IS NOT NULL AND "college_id" IS NOT NULL)
  );

-- Exactly one ISSC.
CREATE UNIQUE INDEX "organizations_single_issc_idx" ON "organizations" ("type") WHERE "type" = 'ISSC';

-- Terms must not end before they start.
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_term_check" CHECK ("term_end" IS NULL OR "term_end" >= "term_start");
