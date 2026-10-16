-- Full-text search over documents. The title weighs more than the description.
-- 'simple' (no stemming) because titles mix English and Filipino, and English
-- stemming mangles Filipino words. Postgres keeps the column up to date itself.
ALTER TABLE "documents"
  ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B')
  ) STORED;

CREATE INDEX "documents_search_vector_idx" ON "documents" USING GIN ("search_vector");
