-- CreateTable
CREATE TABLE "project_files" (
    "id" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "project_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_files_document_id_key" ON "project_files"("document_id");

-- CreateIndex
CREATE INDEX "project_files_project_id_created_at_idx" ON "project_files"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
