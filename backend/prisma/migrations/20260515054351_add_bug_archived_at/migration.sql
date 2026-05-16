-- AlterTable
ALTER TABLE "Bug" ADD COLUMN     "archived_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "ReleaseSourcemap" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Bug_project_id_archived_at_created_at_idx" ON "Bug"("project_id", "archived_at", "created_at" DESC);
