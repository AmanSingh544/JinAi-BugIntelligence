-- AlterTable
ALTER TABLE "Bug" ADD COLUMN     "fix_status" TEXT;

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "github_owner" TEXT NOT NULL,
    "github_repo" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "source_root_prefix" TEXT NOT NULL DEFAULT '',
    "path_overrides" JSONB NOT NULL DEFAULT '{}',
    "installation_id" INTEGER NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "merge_strategy" TEXT NOT NULL DEFAULT 'squash',
    "auto_merge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "min_severity" TEXT NOT NULL DEFAULT 'high',
    "fix_confidence_min" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugFixAttempt" (
    "id" UUID NOT NULL,
    "bug_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "target_file" TEXT,
    "start_line" INTEGER,
    "end_line" INTEGER,
    "original_code" TEXT,
    "fixed_code" TEXT,
    "fix_explanation" TEXT,
    "fix_confidence" DOUBLE PRECISION,
    "branch_name" TEXT,
    "pr_number" INTEGER,
    "pr_url" TEXT,
    "pr_merged_at" TIMESTAMPTZ,
    "validation_passed" BOOLEAN,
    "validation_output" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BugFixAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_project_id_key" ON "ProjectRepository"("project_id");

-- CreateIndex
CREATE INDEX "BugFixAttempt_bug_id_status_idx" ON "BugFixAttempt"("bug_id", "status");

-- CreateIndex
CREATE INDEX "BugFixAttempt_status_pr_number_idx" ON "BugFixAttempt"("status", "pr_number");

-- CreateIndex
CREATE UNIQUE INDEX "BugFixAttempt_bug_id_attempt_number_key" ON "BugFixAttempt"("bug_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugFixAttempt" ADD CONSTRAINT "BugFixAttempt_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugFixAttempt" ADD CONSTRAINT "BugFixAttempt_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "ProjectRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
