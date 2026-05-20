import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GitHubAppService } from '../autofix/github-app.service';

@Injectable()
export class GitHubWebhookService {
  private readonly logger = new Logger(GitHubWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubAppService,
  ) {}

  async dispatch(event: string, payload: Record<string, any>): Promise<void> {
    switch (event) {
      case 'pull_request':
        await this.handlePullRequest(payload);
        break;
      case 'pull_request_review':
        await this.handlePullRequestReview(payload);
        break;
      case 'check_suite':
        await this.handleCheckSuite(payload);
        break;
      default:
        this.logger.debug(`Ignoring unhandled GitHub event: ${event}`);
    }
  }

  // ── pull_request: closed (merged or just closed) ────────────────────────────

  private async handlePullRequest(payload: Record<string, any>): Promise<void> {
    const action = payload.action as string;
    if (action !== 'closed') return;

    const prNumber = payload.pull_request?.number as number | undefined;
    const merged = payload.pull_request?.merged as boolean | undefined;
    if (!prNumber) return;

    const attempt = await this.prisma.bugFixAttempt.findFirst({
      where: { pr_number: prNumber, status: 'pr_open' },
    });
    if (!attempt) return;

    if (merged) {
      this.logger.log(`PR #${prNumber} merged — marking attempt=${attempt.id} as merged`);
      await this.prisma.bugFixAttempt.update({
        where: { id: attempt.id },
        data: { status: 'merged', pr_merged_at: new Date() },
      });
      await this.prisma.bug.update({
        where: { id: attempt.bug_id },
        data: { fix_status: 'merged', status: 'resolved' },
      });
    } else {
      this.logger.log(`PR #${prNumber} closed without merging — marking attempt=${attempt.id} as cancelled`);
      await this.prisma.bugFixAttempt.update({
        where: { id: attempt.id },
        data: { status: 'cancelled', failure_reason: 'PR closed without merging' },
      });
      await this.prisma.bug.update({
        where: { id: attempt.bug_id },
        data: { fix_status: null },
      });
    }
  }

  // ── pull_request_review: submitted ──────────────────────────────────────────

  private async handlePullRequestReview(payload: Record<string, any>): Promise<void> {
    const action = payload.action as string;
    if (action !== 'submitted') return;

    const reviewState = payload.review?.state as string | undefined;
    const prNumber = payload.pull_request?.number as number | undefined;
    if (!prNumber || !reviewState) return;

    const attempt = await this.prisma.bugFixAttempt.findFirst({
      where: { pr_number: prNumber, status: 'pr_open' },
      include: { repository: true },
    });
    if (!attempt) return;

    if (reviewState === 'approved' && attempt.repository.auto_merge_enabled) {
      if (attempt.validation_passed !== true) {
        this.logger.warn(`PR #${prNumber} approved but CI has not passed yet — deferring auto-merge until check_suite`);
      } else {
        this.logger.log(`PR #${prNumber} approved + CI passed + auto_merge_enabled — merging`);
        await this.mergePullRequest(
          attempt.repository.installation_id,
          attempt.repository.github_owner,
          attempt.repository.github_repo,
          prNumber,
          attempt.repository.merge_strategy as 'merge' | 'squash' | 'rebase',
        );
      }
    } else if (reviewState === 'changes_requested') {
      this.logger.log(`PR #${prNumber} had changes requested — marking attempt=${attempt.id} failed`);
      await this.prisma.bugFixAttempt.update({
        where: { id: attempt.id },
        data: { status: 'failed', failure_reason: 'Changes requested on PR — fix requires revision' },
      });
      await this.prisma.bug.update({
        where: { id: attempt.bug_id },
        data: { fix_status: 'fix_failed' },
      });
    }
  }

  // ── check_suite: completed ───────────────────────────────────────────────────

  private async handleCheckSuite(payload: Record<string, any>): Promise<void> {
    const action = payload.action as string;
    if (action !== 'completed') return;

    const conclusion = payload.check_suite?.conclusion as string | undefined;
    const headBranch = payload.check_suite?.head_branch as string | undefined;
    if (!headBranch || !conclusion) return;

    if (!headBranch.startsWith('autofix/')) return;

    const attempt = await this.prisma.bugFixAttempt.findFirst({
      where: { branch_name: headBranch, status: 'pr_open' },
      include: { repository: true },
    });
    if (!attempt) return;

    if (conclusion === 'failure' || conclusion === 'cancelled') {
      this.logger.warn(`CI failed on branch=${headBranch} for attempt=${attempt.id} (conclusion=${conclusion})`);
      await this.prisma.bugFixAttempt.update({
        where: { id: attempt.id },
        data: {
          validation_passed: false,
          validation_output: `CI checks ${conclusion} on branch ${headBranch}`,
        },
      });
    } else if (conclusion === 'success') {
      this.logger.log(`CI passed on branch=${headBranch} for attempt=${attempt.id}`);
      await this.prisma.bugFixAttempt.update({
        where: { id: attempt.id },
        data: { validation_passed: true, validation_output: 'CI passed' },
      });
      // Attempt auto-merge if enabled — handles the case where approval arrived before CI
      if (attempt.repository.auto_merge_enabled && attempt.pr_number) {
        await this.tryAutoMerge({ ...attempt, pr_number: attempt.pr_number });
      }
    }
  }

  // ─── Try auto-merge after CI passes (handles approve-before-CI ordering) ────

  private async tryAutoMerge(attempt: {
    id: string;
    pr_number: number;
    repository: { installation_id: number; github_owner: string; github_repo: string; merge_strategy: string; auto_merge_enabled: boolean };
  }): Promise<void> {
    const { installation_id, github_owner, github_repo, merge_strategy } = attempt.repository;
    const prNumber = attempt.pr_number;

    try {
      const reviews = await this.listPrReviews(installation_id, github_owner, github_repo, prNumber);
      const hasApproval = reviews.some((r: { state: string }) => r.state === 'APPROVED');
      if (!hasApproval) {
        this.logger.log(`CI passed for PR #${prNumber} but no approval yet — waiting`);
        return;
      }
      this.logger.log(`CI passed + prior approval found for PR #${prNumber} — auto-merging`);
      await this.mergePullRequest(installation_id, github_owner, github_repo, prNumber, merge_strategy as 'merge' | 'squash' | 'rebase');
    } catch (err) {
      this.logger.warn(`tryAutoMerge failed for PR #${prNumber}: ${(err as Error).message}`);
    }
  }

  private async listPrReviews(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Array<{ state: string }>> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    );
    if (!res.ok) {
      throw new Error(`List PR reviews [${res.status}]: ${await res.text()}`);
    }
    return res.json() as Promise<Array<{ state: string }>>;
  }

  // ─── GitHub merge call ───────────────────────────────────────────────────────

  private async mergePullRequest(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase',
  ): Promise<void> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      { method: 'PUT', body: JSON.stringify({ merge_method: mergeMethod }) },
    );
    if (!res.ok && res.status !== 405) {
      // 405 means already merged — safe to ignore
      const body = await res.text();
      throw new Error(`Failed to merge PR #${prNumber} [${res.status}]: ${body}`);
    }
    this.logger.log(`Merged PR #${prNumber} via ${mergeMethod}`);
  }
}
