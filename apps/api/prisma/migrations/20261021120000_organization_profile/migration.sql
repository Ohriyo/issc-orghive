-- Organization profiles (/dashboard/profile) and the Constitution & By-laws, 2026-10-21.
-- The organization's own account edits these; name, acronym, type and college stay with
-- the ISSC account.
ALTER TABLE "organizations"
  ADD COLUMN "mission" TEXT,
  ADD COLUMN "vision" TEXT,
  ADD COLUMN "contact_email" VARCHAR(254),
  ADD COLUMN "facebook_url" VARCHAR(300),
  ADD COLUMN "cover_key" TEXT,
  ADD COLUMN "cover_widths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "constitution_document_id" UUID;

-- One constitution per organization, and a document is the constitution of one at most.
CREATE UNIQUE INDEX "organizations_constitution_document_id_key"
  ON "organizations"("constitution_document_id");
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_constitution_document_id_fkey"
  FOREIGN KEY ("constitution_document_id") REFERENCES "documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "organization_officers" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "position" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_public" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_officers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "organization_officers_organization_id_sort_order_idx"
  ON "organization_officers"("organization_id", "sort_order");
ALTER TABLE "organization_officers" ADD CONSTRAINT "organization_officers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_links" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "url" VARCHAR(300) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "organization_links_organization_id_sort_order_idx"
  ON "organization_links"("organization_id", "sort_order");
ALTER TABLE "organization_links" ADD CONSTRAINT "organization_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constitution versions: the date adopted or amended, and what the amendment changed.
ALTER TABLE "document_versions"
  ADD COLUMN "amended_on" DATE,
  ADD COLUMN "note" VARCHAR(280);

-- The document type constitutions are filed as (CONSTITUTION_DOCUMENT_TYPE in packages/shared).
INSERT INTO "document_types" ("id", "slug", "name")
VALUES (gen_random_uuid(), 'constitution-by-laws', 'Constitution & By-laws')
ON CONFLICT ("slug") DO NOTHING;
