-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('owner', 'admin', 'developer', 'viewer');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "Bug" DROP CONSTRAINT "Bug_assigned_to_fkey";

-- DropForeignKey
ALTER TABLE "Bug" DROP CONSTRAINT "Bug_session_id_fkey";

-- DropForeignKey
ALTER TABLE "Error" DROP CONSTRAINT "Error_event_id_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "TenantMember" DROP CONSTRAINT "TenantMember_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "TenantMember" DROP CONSTRAINT "TenantMember_user_id_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Bug" ADD COLUMN     "ai_confidence" DOUBLE PRECISION,
ADD COLUMN     "regression_detected_at" TIMESTAMPTZ,
ADD COLUMN     "regression_release_id" UUID,
ALTER COLUMN "session_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Error" ADD COLUMN     "release_id" UUID,
ADD COLUMN     "stack_unminified" TEXT,
ALTER COLUMN "event_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ErrorCluster" ADD COLUMN     "bug_id" UUID;

-- AlterTable
ALTER TABLE "IntegrationDelivery" ADD COLUMN     "dispatch_key" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "environment_id" UUID;

-- AlterTable
ALTER TABLE "Tenant" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TenantMember" ALTER COLUMN "id" DROP DEFAULT,
DROP COLUMN "role",
ADD COLUMN     "role" "TenantRole" NOT NULL DEFAULT 'owner';

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" UUID NOT NULL,
    "bug_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "sampling_click" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampling_navigation" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampling_console" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampling_api" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampling_error" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "replay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "screenshot_on_error" BOOLEAN NOT NULL DEFAULT false,
    "retention_events_days" INTEGER NOT NULL DEFAULT 30,
    "retention_sessions_days" INTEGER NOT NULL DEFAULT 30,
    "retention_replay_days" INTEGER NOT NULL DEFAULT 7,
    "retention_screenshots_days" INTEGER NOT NULL DEFAULT 14,
    "retention_bug_detail_days" INTEGER NOT NULL DEFAULT 30,
    "retention_dlq_days" INTEGER NOT NULL DEFAULT 14,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "sourcemap" TEXT,
    "sourcemap_size" INTEGER,
    "sourcemap_parsed" BOOLEAN NOT NULL DEFAULT false,
    "sourcemap_error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplaySegment" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "events" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplaySegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "bug_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "bug_id" UUID,
    "type" TEXT NOT NULL DEFAULT 'bug_created',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "severity" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatThread_bug_id_key" ON "ChatThread"("bug_id");

-- CreateIndex
CREATE INDEX "ChatMessage_thread_id_created_at_idx" ON "ChatMessage"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvironment_project_id_name_key" ON "ProjectEnvironment"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Release_project_id_version_key" ON "Release"("project_id", "version");

-- CreateIndex
CREATE INDEX "ReplaySegment_session_id_sequence_idx" ON "ReplaySegment"("session_id", "sequence");

-- CreateIndex
CREATE INDEX "NotificationChannel_project_id_is_active_idx" ON "NotificationChannel"("project_id", "is_active");

-- CreateIndex
CREATE INDEX "UserNotification_user_id_read_at_idx" ON "UserNotification"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "UserNotification_user_id_created_at_idx" ON "UserNotification"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorCluster_bug_id_key" ON "ErrorCluster"("bug_id");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_dispatch_key_key" ON "IntegrationDelivery"("dispatch_key");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_bug_id_integration_id_idx" ON "IntegrationDelivery"("bug_id", "integration_id");

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "ProjectEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Error" ADD CONSTRAINT "Error_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCluster" ADD CONSTRAINT "ErrorCluster_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_regression_release_id_fkey" FOREIGN KEY ("regression_release_id") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvironment" ADD CONSTRAINT "ProjectEnvironment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplaySegment" ADD CONSTRAINT "ReplaySegment_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplaySegment" ADD CONSTRAINT "ReplaySegment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_bug_id_fkey" FOREIGN KEY ("bug_id") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AuditLog_actor_created_idx" RENAME TO "AuditLog_actor_id_created_at_idx";

-- RenameIndex
ALTER INDEX "AuditLog_tenant_created_idx" RENAME TO "AuditLog_tenant_id_created_at_idx";
