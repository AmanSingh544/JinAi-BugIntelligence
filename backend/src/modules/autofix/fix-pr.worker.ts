import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { EventsSseService } from '../events/events-sse.service';
import { GitHubAppService } from './github-app.service';
import { FixPrJob, FIX_PR_QUEUE } from './fix-pr.queue';

const MAX_BRANCH_NAME_LEN = 80;

@Injectable()
export class FixPrWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<FixPrJob>;
  private readonly logger = new Logger(FixPrWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly github: GitHubAppService,
    private readonly sse: EventsSseService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<FixPrJob>(
      FIX_PR_QUEUE,
      async (job: Job<FixPrJob>) => this.process(job),
      { connection: this.redis, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`PR creation job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<FixPrJob>) {
    return this.metrics.wrapJob('fix-pr-creation', async () => {
      const { attemptId, bugId, projectId } = job.data;
      this.logger.log(
        `PR creation started for attempt=${attemptId} bug=${bugId}`,
      );

      // ── 1. Load attempt + related data ───────────────────────────────────────
      const attempt = await this.prisma.bugFixAttempt.findUnique({
        where: { id: attemptId },
        include: {
          bug: {
            include: {
              error: { select: { message: true } },
              project: { select: { id: true, tenant_id: true } },
            },
          },
          repository: true,
        },
      });

      if (!attempt)
        return this.logger.warn(`Attempt ${attemptId} not found — skipping`);
      if (attempt.status !== 'validated') {
        return this.logger.warn(
          `Attempt ${attemptId} status=${attempt.status} (not validated) — skipping`,
        );
      }
      if (
        !attempt.target_file ||
        !attempt.fixed_code ||
        attempt.start_line == null
      ) {
        return this.failAttempt(
          attemptId,
          'Attempt is missing required fix data',
        );
      }

      const repo = attempt.repository;
      const bug = attempt.bug;

      // ── 2. Get branch SHA ────────────────────────────────────────────────────
      let baseSha: string;
      try {
        baseSha = await this.getBranchSha(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          repo.default_branch,
        );
      } catch (err) {
        return this.failAttempt(
          attemptId,
          `Failed to get branch SHA: ${(err as Error).message}`,
        );
      }

      // ── 3. Create fix branch ─────────────────────────────────────────────────
      const branchName = this.buildBranchName(bugId, attemptId);
      try {
        await this.createBranch(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          branchName,
          baseSha,
        );
      } catch (err) {
        const msg = (err as Error).message;
        if (!msg.includes('already exists')) {
          return this.failAttempt(attemptId, `Failed to create branch: ${msg}`);
        }
        this.logger.debug(`Branch ${branchName} already exists — continuing`);
      }

      // ── 4. Get current file SHA (required for update API) ────────────────────
      let fileSha: string;
      try {
        fileSha = await this.getFileSha(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          attempt.target_file,
          branchName,
        );
      } catch (err) {
        return this.failAttempt(
          attemptId,
          `Failed to get file SHA: ${(err as Error).message}`,
        );
      }

      // ── 5. Fetch current file content from branch, apply fix ─────────────────
      let currentContent: string;
      try {
        currentContent = await this.fetchFileContent(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          attempt.target_file,
          branchName,
        );
      } catch (err) {
        return this.failAttempt(
          attemptId,
          `Failed to fetch file: ${(err as Error).message}`,
        );
      }

      const newContent = this.applyFix(
        currentContent,
        attempt.start_line,
        attempt.end_line ?? attempt.start_line,
        attempt.original_code ?? '',
        attempt.fixed_code,
      );

      if (!newContent) {
        return this.failAttempt(
          attemptId,
          'Source mismatch when re-applying fix to branch content — branch may have diverged',
        );
      }

      // ── 6. Commit the fix to the branch ──────────────────────────────────────
      const commitMessage = this.buildCommitMessage(
        bug.error.message,
        attempt.fix_explanation ?? '',
      );
      try {
        await this.commitFile(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          attempt.target_file,
          newContent,
          fileSha,
          branchName,
          commitMessage,
        );
      } catch (err) {
        return this.failAttempt(
          attemptId,
          `Failed to commit fix: ${(err as Error).message}`,
        );
      }

      // ── 7. Open the pull request ──────────────────────────────────────────────
      const prTitle = `fix: ${this.truncate(bug.error.message, 60)}`;
      const prBody = this.buildPrBody(bug, attempt);

      let prNumber: number;
      let prUrl: string;
      try {
        const pr = await this.createPullRequest(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          prTitle,
          prBody,
          branchName,
          repo.default_branch,
        );
        prNumber = pr.number;
        prUrl = pr.html_url;
      } catch (err) {
        return this.failAttempt(
          attemptId,
          `Failed to create PR: ${(err as Error).message}`,
        );
      }

      // ── 8. Add PR labels ──────────────────────────────────────────────────────
      const severity = (bug as any).severity as string | undefined;
      const labels = [
        'bug-intelligence-fix',
        ...(severity ? [`severity-${severity}`] : []),
      ];
      try {
        await this.addPrLabels(
          repo.installation_id,
          repo.github_owner,
          repo.github_repo,
          prNumber,
          labels,
        );
      } catch (err) {
        // Labels are best-effort — don't fail the whole PR for this
        this.logger.warn(
          `Could not add labels to PR #${prNumber}: ${(err as Error).message}`,
        );
      }

      // ── 9. Persist PR details ─────────────────────────────────────────────────
      await this.prisma.bugFixAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'pr_open',
          branch_name: branchName,
          pr_number: prNumber,
          pr_url: prUrl,
        },
      });
      await this.prisma.bug.update({
        where: { id: bugId },
        data: { fix_status: 'pr_open' },
      });

      // ── 10. SSE broadcast + in-app notification ───────────────────────────────
      const tenantId = bug.project.tenant_id;

      this.sse.broadcast(
        {
          event: 'bug:fix_pr_opened',
          data: { bugId, projectId, prUrl, prNumber },
        },
        { tenantId },
      );

      try {
        const members = await this.prisma.tenantMember.findMany({
          where: { tenant_id: tenantId },
          select: { user_id: true },
        });
        await Promise.all(
          members.map((m) =>
            this.prisma.userNotification.create({
              data: {
                user_id: m.user_id,
                project_id: projectId,
                bug_id: bugId,
                type: 'autofix_pr_opened',
                title: `Autofix PR opened: ${this.truncate(bug.error.message, 60)}`,
                body: `PR #${prNumber} was automatically created to fix this bug. Review it on GitHub.`,
                severity: severity ?? 'medium',
              },
            }),
          ),
        );
      } catch (err) {
        this.logger.warn(
          `Could not create PR notifications for bug=${bugId}: ${(err as Error).message}`,
        );
      }

      this.logger.log(
        `PR #${prNumber} opened for bug=${bugId} attempt=${attemptId}: ${prUrl}`,
      );
    });
  }

  // ─── GitHub helpers ─────────────────────────────────────────────────────────

  private async getBranchSha(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    );
    if (!res.ok)
      throw new Error(`GET branch ref [${res.status}]: ${await res.text()}`);
    const data = (await res.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async createBranch(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ): Promise<void> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Create branch [${res.status}]: ${body}`);
    }
  }

  private async getFileSha(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    branch: string,
  ): Promise<string> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    );
    if (!res.ok)
      throw new Error(`GET file SHA [${res.status}]: ${await res.text()}`);
    const data = (await res.json()) as { sha: string };
    return data.sha;
  }

  private async fetchFileContent(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    branch: string,
  ): Promise<string> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    );
    if (!res.ok)
      throw new Error(`GET file content [${res.status}]: ${await res.text()}`);
    const data = (await res.json()) as { content: string; encoding: string };
    if (data.encoding !== 'base64')
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
      'utf-8',
    );
  }

  private async commitFile(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    content: string,
    sha: string,
    branch: string,
    message: string,
  ): Promise<void> {
    const encoded = Buffer.from(content, 'utf-8').toString('base64');
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ message, content: encoded, sha, branch }),
      },
    );
    if (!res.ok)
      throw new Error(`Commit file [${res.status}]: ${await res.text()}`);
  }

  private async addPrLabels(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
  ): Promise<void> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/issues/${prNumber}/labels`,
      { method: 'POST', body: JSON.stringify({ labels }) },
    );
    if (!res.ok)
      throw new Error(`Add labels [${res.status}]: ${await res.text()}`);
  }

  private async createPullRequest(
    installationId: number,
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<{ number: number; html_url: string }> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/pulls`,
      { method: 'POST', body: JSON.stringify({ title, body, head, base }) },
    );
    if (!res.ok)
      throw new Error(`Create PR [${res.status}]: ${await res.text()}`);
    return res.json() as Promise<{ number: number; html_url: string }>;
  }

  // ─── Content helpers ─────────────────────────────────────────────────────────

  private applyFix(
    content: string,
    startLine: number,
    endLine: number,
    originalCode: string,
    fixedCode: string,
  ): string | null {
    const lines = content.split('\n');
    if (startLine < 1 || endLine > lines.length) return null;

    const slice = lines.slice(startLine - 1, endLine).join('\n');
    const normalize = (s: string) =>
      s
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
    if (normalize(slice) !== normalize(originalCode)) return null;

    const fixLines = fixedCode.split('\n');
    return [
      ...lines.slice(0, startLine - 1),
      ...fixLines,
      ...lines.slice(endLine),
    ].join('\n');
  }

  private buildBranchName(bugId: string, attemptId: string): string {
    const short = `autofix/bug-${bugId.slice(0, 8)}-${attemptId.slice(0, 8)}`;
    return short.slice(0, MAX_BRANCH_NAME_LEN);
  }

  private buildCommitMessage(
    errorMessage: string,
    explanation: string,
  ): string {
    const headline = `fix: ${this.truncate(errorMessage, 60)}`;
    const body = explanation ? `\n\n${explanation}` : '';
    return `${headline}${body}\n\n[autofix]`;
  }

  private buildPrBody(
    bug: {
      id: string;
      summary: string | null;
      root_cause: string | null;
      fix_suggestion: string | null;
      error: { message: string };
    },
    attempt: {
      id: string;
      fix_explanation: string | null;
      fix_confidence: number | null;
      target_file: string | null;
      start_line: number | null;
      end_line: number | null;
    },
  ): string {
    return `## Automated Bug Fix

**Bug ID:** \`${bug.id}\`
**Error:** ${bug.error.message}

${bug.summary ? `**Summary:** ${bug.summary}\n` : ''}
${bug.root_cause ? `**Root Cause:** ${bug.root_cause}\n` : ''}

### Fix Details

**File:** \`${attempt.target_file ?? 'unknown'}\`
**Lines:** ${attempt.start_line}–${attempt.end_line}
**Explanation:** ${attempt.fix_explanation ?? 'N/A'}
**AI Confidence:** ${attempt.fix_confidence != null ? `${Math.round(attempt.fix_confidence * 100)}%` : 'N/A'}

---
*Generated by Bug Intelligence Autofix. Attempt ID: \`${attempt.id}\`*`;
  }

  private truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 3) + '...';
  }

  // ─── Mark attempt as failed ───────────────────────────────────────────────────

  private async failAttempt(attemptId: string, reason: string) {
    this.logger.warn(`PR creation attempt ${attemptId} failed: ${reason}`);
    const attempt = await this.prisma.bugFixAttempt.update({
      where: { id: attemptId },
      data: { status: 'failed', failure_reason: reason },
    });
    // Reset bug fix_status so the bug doesn't appear permanently stuck
    await this.prisma.bug.update({
      where: { id: attempt.bug_id },
      data: { fix_status: 'fix_failed' },
    });
  }
}
