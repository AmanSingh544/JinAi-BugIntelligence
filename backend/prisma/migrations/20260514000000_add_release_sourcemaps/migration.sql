-- CreateTable
CREATE TABLE "ReleaseSourcemap" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "release_id" UUID NOT NULL,
    "minified_filename" TEXT NOT NULL,
    "declared_file" TEXT,
    "sourcemap_path" TEXT NOT NULL,
    "sourcemap_size" INTEGER,
    "content_hash" TEXT,
    "sourcemap_parsed" BOOLEAN NOT NULL DEFAULT false,
    "sourcemap_error" TEXT,
    "parse_warnings" JSONB,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseSourcemap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseSourcemap_release_id_minified_filename_key" ON "ReleaseSourcemap"("release_id", "minified_filename");

-- CreateIndex
CREATE INDEX "ReleaseSourcemap_release_id_idx" ON "ReleaseSourcemap"("release_id");

-- AddForeignKey
ALTER TABLE "ReleaseSourcemap" ADD CONSTRAINT "ReleaseSourcemap_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
