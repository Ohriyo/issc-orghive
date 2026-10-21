-- The Student Handbook (docs/DOMAIN_RULES.md, "Student Handbook"), 2026-10-21: one edition
-- per academic year, filed as a public, view-only ISSC document; one edition is current.
CREATE TABLE "handbook_editions" (
  "id" UUID NOT NULL,
  "academic_year" VARCHAR(9) NOT NULL,
  "document_id" UUID NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "handbook_editions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "handbook_editions_academic_year_key" ON "handbook_editions"("academic_year");
CREATE UNIQUE INDEX "handbook_editions_document_id_key" ON "handbook_editions"("document_id");
-- Exactly one current edition at most.
CREATE UNIQUE INDEX "handbook_editions_one_current" ON "handbook_editions"("is_current")
  WHERE "is_current";
ALTER TABLE "handbook_editions" ADD CONSTRAINT "handbook_editions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bookmarks and page thumbnails for the handbook's contents.
ALTER TABLE "document_versions"
  ADD COLUMN "outline" JSONB,
  ADD COLUMN "page_thumbnails" BOOLEAN NOT NULL DEFAULT false;

-- Each page's text, for searching inside the handbook and jumping to the page.
CREATE TABLE "document_page_texts" (
  "version_id" UUID NOT NULL,
  "page" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', left("text", 100000))
  ) STORED,

  CONSTRAINT "document_page_texts_pkey" PRIMARY KEY ("version_id", "page")
);
CREATE INDEX "document_page_texts_search_vector_idx" ON "document_page_texts" USING GIN ("search_vector");
ALTER TABLE "document_page_texts" ADD CONSTRAINT "document_page_texts_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The document type editions are filed as (HANDBOOK_DOCUMENT_TYPE in packages/shared).
INSERT INTO "document_types" ("id", "slug", "name")
VALUES (gen_random_uuid(), 'student-handbook', 'Student Handbook')
ON CONFLICT ("slug") DO NOTHING;
