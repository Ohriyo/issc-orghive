-- AlterEnum
ALTER TYPE "ScanStatus" ADD VALUE 'invalid';

-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "processed_at" TIMESTAMP(3),
ADD COLUMN     "thumbnail_key" TEXT,
ALTER COLUMN "sha256" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "content_text" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "upload_intents" (
    "key" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "upload_intents_user_id_idx" ON "upload_intents"("user_id");

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search also covers the text the worker extracts from each document's current
-- PDF (weight C, below title A and description B). A generated column cannot be altered,
-- so it is dropped and re-added; Postgres recomputes it for existing rows.
DROP INDEX IF EXISTS "documents_search_vector_idx";
ALTER TABLE "documents" DROP COLUMN "search_vector";
ALTER TABLE "documents"
  ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(left("content_text", 200000), '')), 'C')
  ) STORED;
CREATE INDEX "documents_search_vector_idx" ON "documents" USING GIN ("search_vector");
