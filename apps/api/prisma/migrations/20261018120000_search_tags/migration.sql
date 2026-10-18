-- Search ranks a document's tags with its description (weight B), between the title (A)
-- and the text extracted from its file (C). array_to_string is only STABLE, which a
-- generated column refuses; for text[] it cannot change, so this wrapper is IMMUTABLE.
CREATE FUNCTION "orghive_tags_text"(tags text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN array_to_string(tags, ' ');

-- A generated column cannot be altered, so it is dropped and re-added; Postgres recomputes
-- it for existing rows.
DROP INDEX IF EXISTS "documents_search_vector_idx";
ALTER TABLE "documents" DROP COLUMN "search_vector";
ALTER TABLE "documents"
  ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', orghive_tags_text("tags")), 'B') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(left("content_text", 200000), '')), 'C')
  ) STORED;
CREATE INDEX "documents_search_vector_idx" ON "documents" USING GIN ("search_vector");
