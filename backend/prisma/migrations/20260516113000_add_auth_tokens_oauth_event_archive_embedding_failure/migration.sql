-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oauth_id" TEXT,
ADD COLUMN     "oauth_provider" TEXT,
ADD COLUMN     "reset_token_expires_at" TIMESTAMPTZ,
ADD COLUMN     "reset_token_hash" TEXT,
ADD COLUMN     "verification_token_expires_at" TIMESTAMPTZ,
ADD COLUMN     "verification_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_oauth_provider_oauth_id_key" ON "User"("oauth_provider", "oauth_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_reset_token_hash_key" ON "User"("reset_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "User_verification_token_hash_key" ON "User"("verification_token_hash");

-- CreateTable
CREATE TABLE "EventArchive" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EventArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventArchive_created_at_idx" ON "EventArchive"("created_at");

-- CreateIndex
CREATE INDEX "EventArchive_project_id_session_id_timestamp_idx" ON "EventArchive"("project_id", "session_id", "timestamp");

-- CreateTable
CREATE TABLE "EmbeddingFailure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "error_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbeddingFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmbeddingFailure_created_at_idx" ON "EmbeddingFailure"("created_at");

-- CreateIndex
CREATE INDEX "EmbeddingFailure_error_id_idx" ON "EmbeddingFailure"("error_id");
