import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { unlink } from 'fs/promises';
import { join } from 'path';

const UPLOAD_DIR = './uploads/screenshots';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runCleanup() {
    this.logger.log('Starting retention cleanup...');
    const start = Date.now();

    const envs = await this.prisma.projectEnvironment.findMany({
      include: { project: { select: { id: true, name: true } } },
    });

    let totalDeleted = 0;
    for (const env of envs) {
      const project = env.project;
      try {
        const [
          replayCount,
          eventCount,
          screenshotCount,
          bugDetailCount,
          dlqCount,
        ] = await Promise.all([
          this.cleanupReplay(env.project_id, env.retention_replay_days),
          this.cleanupEvents(env.project_id, env.retention_events_days),
          this.cleanupScreenshots(env.project_id, env.retention_screenshots_days),
          this.cleanupBugDetails(env.project_id, env.retention_bug_detail_days),
          this.cleanupDlq(env.project_id, env.retention_dlq_days),
        ]);

        totalDeleted += replayCount + eventCount + screenshotCount + bugDetailCount + dlqCount;
        this.logger.debug(
          `Retention cleanup for project=${project.name} env=${env.name}: ` +
            `replay=${replayCount}, events=${eventCount}, screenshots=${screenshotCount}, ` +
            `bugDetails=${bugDetailCount}, dlq=${dlqCount}`,
        );
      } catch (err) {
        this.logger.error(
          `Retention cleanup failed for project=${project.name} env=${env.name}: ${(err as Error).message}`,
        );
      }
    }

    // Also clean up orphaned sessions (sessions with no events, no replay, no errors)
    const orphanedSessionCount = await this.cleanupOrphanedSessions();

    this.logger.log(
      `Retention cleanup complete in ${Date.now() - start}ms. ` +
        `Deleted/cleared ${totalDeleted} records, ${orphanedSessionCount} orphaned sessions.`,
    );
  }

  private async cleanupReplay(projectId: string, days: number): Promise<number> {
    if (days <= 0) return 0;
    const result = await this.prisma.$executeRaw`
      DELETE FROM "ReplaySegment"
      WHERE project_id = ${projectId}::uuid
        AND created_at < NOW() - INTERVAL '${days} days'
    `;
    return Number(result);
  }

  private async cleanupEvents(projectId: string, days: number): Promise<number> {
    if (days <= 0) return 0;
    const result = await this.prisma.$executeRaw`
      DELETE FROM "Event"
      WHERE project_id = ${projectId}::uuid
        AND created_at < NOW() - INTERVAL '${days} days'
    `;
    return Number(result);
  }

  private async cleanupScreenshots(projectId: string, days: number): Promise<number> {
    if (days <= 0) return 0;
    const bugs = await this.prisma.$queryRaw<Array<{ screenshot_url: string }>>`
      SELECT screenshot_url
      FROM "Bug"
      WHERE project_id = ${projectId}::uuid
        AND screenshot_url IS NOT NULL
        AND created_at < NOW() - INTERVAL '${days} days'
    `;

    let deletedFiles = 0;
    for (const bug of bugs) {
      try {
        const filename = bug.screenshot_url.split('/').pop();
        if (filename) {
          await unlink(join(UPLOAD_DIR, filename));
          deletedFiles++;
        }
      } catch {
        // File may already be deleted
      }
    }

    const result = await this.prisma.$executeRaw`
      UPDATE "Bug"
      SET screenshot_url = NULL
      WHERE project_id = ${projectId}::uuid
        AND screenshot_url IS NOT NULL
        AND created_at < NOW() - INTERVAL '${days} days'
    `;
    return Number(result);
  }

  private async cleanupBugDetails(projectId: string, days: number): Promise<number> {
    if (days <= 0) return 0;
    const result = await this.prisma.$executeRaw`
      UPDATE "Bug"
      SET ai_raw_output = NULL, replay_url = NULL
      WHERE project_id = ${projectId}::uuid
        AND (ai_raw_output IS NOT NULL OR replay_url IS NOT NULL)
        AND created_at < NOW() - INTERVAL '${days} days'
    `;
    return Number(result);
  }

  private async cleanupDlq(projectId: string, days: number): Promise<number> {
    if (days <= 0) return 0;
    const result = await this.prisma.$executeRaw`
      DELETE FROM "IntegrationDelivery"
      WHERE status = 'dead'
        AND created_at < NOW() - INTERVAL '${days} days'
        AND integration_id IN (
          SELECT id FROM "ProjectIntegration" WHERE project_id = ${projectId}::uuid
        )
    `;
    return Number(result);
  }

  private async cleanupOrphanedSessions(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM "Session"
      WHERE id NOT IN (SELECT DISTINCT session_id FROM "Event" WHERE session_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT session_id FROM "Error" WHERE session_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT session_id FROM "ReplaySegment" WHERE session_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT session_id FROM "Bug" WHERE session_id IS NOT NULL)
    `;
    return Number(result);
  }
}
