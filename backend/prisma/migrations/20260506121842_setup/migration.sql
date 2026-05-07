-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "allowed_origins" TEXT[],
    "block_unknown_origins" BOOLEAN NOT NULL DEFAULT false,
    "clustering_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "user_agent" TEXT,
    "initial_url" TEXT,
    "metadata" JSONB,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Error" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "fingerprint" TEXT NOT NULL,
    "dedup_bucket" TIMESTAMPTZ NOT NULL,
    "vector" vector(1536),
    "cluster_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Error_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorCluster" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "centroid" vector(1536),
    "label" TEXT,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bug" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "error_id" UUID NOT NULL,
    "summary" TEXT,
    "root_cause" TEXT,
    "steps_to_reproduce" JSONB,
    "fix_suggestion" TEXT,
    "severity" TEXT,
    "screenshot_url" TEXT,
    "replay_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ai_model_version" TEXT,
    "ai_raw_output" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPromptVersion" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIntegration" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "bug_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remote_ticket_id" TEXT,
    "remote_ticket_url" TEXT,
    "response" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecutionLog" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "bug_id" UUID NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "action_taken" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_api_key_hash_key" ON "Project"("api_key_hash");

-- CreateIndex
CREATE INDEX "Session_project_id_started_at_idx" ON "Session"("project_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "Event_project_id_session_id_timestamp_idx" ON "Event"("project_id", "session_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Error_event_id_key" ON "Error"("event_id");

-- CreateIndex
CREATE INDEX "Error_project_id_fingerprint_idx" ON "Error"("project_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Error_fingerprint_project_id_dedup_bucket_key" ON "Error"("fingerprint", "project_id", "dedup_bucket");

-- CreateIndex
CREATE INDEX "ErrorCluster_project_id_idx" ON "ErrorCluster"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "Bug_error_id_key" ON "Bug"("error_id");

-- CreateIndex
CREATE INDEX "Bug_project_id_status_created_at_idx" ON "Bug"("project_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AiPromptVersion_version_key" ON "AiPromptVersion"("version");

-- CreateIndex
CREATE INDEX "ProjectIntegration_project_id_is_active_idx" ON "ProjectIntegration"("project_id", "is_active");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_status_next_retry_at_idx" ON "IntegrationDelivery"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "Rule_project_id_is_active_idx" ON "Rule"("project_id", "is_active");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "ErrorCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCluster" ADD CONSTRAINT "ErrorCluster_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_error_id_fkey" FOREIGN KEY ("error_id") REFERENCES "Error"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntegration" ADD CONSTRAINT "ProjectIntegration_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "ProjectIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecutionLog" ADD CONSTRAINT "RuleExecutionLog_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecutionLog" ADD CONSTRAINT "RuleExecutionLog_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
