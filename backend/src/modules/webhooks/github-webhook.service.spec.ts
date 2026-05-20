import { Test } from '@nestjs/testing';
import { GitHubWebhookService } from './github-webhook.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GitHubAppService } from '../autofix/github-app.service';

const mockAttempt = {
  id: 'attempt-1',
  bug_id: 'bug-1',
  pr_number: 42,
  branch_name: 'autofix/bug-abc-def',
  status: 'pr_open',
  repository: {
    installation_id: 1234,
    github_owner: 'acme',
    github_repo: 'app',
    auto_merge_enabled: false,
    merge_strategy: 'squash',
  },
};

describe('GitHubWebhookService', () => {
  let service: GitHubWebhookService;
  let prisma: jest.Mocked<PrismaService>;
  let github: jest.Mocked<GitHubAppService>;

  beforeEach(async () => {
    const mockPrisma = {
      bugFixAttempt: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(mockAttempt),
      },
      bug: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const mockGithub = {
      apiRequest: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        GitHubWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GitHubAppService, useValue: mockGithub },
      ],
    }).compile();

    service = module.get(GitHubWebhookService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    github = module.get(GitHubAppService) as jest.Mocked<GitHubAppService>;
  });

  describe('pull_request: closed + merged', () => {
    it('marks attempt merged and bug resolved', async () => {
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(mockAttempt);
      await service.dispatch('pull_request', {
        action: 'closed',
        pull_request: { number: 42, merged: true },
      });
      expect(prisma.bugFixAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'merged' }) }),
      );
      expect(prisma.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'resolved' }) }),
      );
    });
  });

  describe('pull_request: closed without merge', () => {
    it('marks attempt cancelled and clears fix_status', async () => {
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(mockAttempt);
      await service.dispatch('pull_request', {
        action: 'closed',
        pull_request: { number: 42, merged: false },
      });
      expect(prisma.bugFixAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      );
      expect(prisma.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fix_status: null } }),
      );
    });
  });

  describe('pull_request: non-closed action', () => {
    it('ignores non-closed actions', async () => {
      await service.dispatch('pull_request', { action: 'opened', pull_request: { number: 42 } });
      expect(prisma.bugFixAttempt.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('pull_request_review: approved + auto_merge_enabled + CI passed', () => {
    it('calls GitHub merge API when validation_passed is true', async () => {
      const autoMergeAttempt = {
        ...mockAttempt,
        validation_passed: true,
        repository: { ...mockAttempt.repository, auto_merge_enabled: true },
      };
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(autoMergeAttempt);
      (github.apiRequest as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      await service.dispatch('pull_request_review', {
        action: 'submitted',
        review: { state: 'approved' },
        pull_request: { number: 42 },
      });
      expect(github.apiRequest).toHaveBeenCalledWith(
        1234,
        '/repos/acme/app/pulls/42/merge',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('skips merge when validation_passed is not true (CI pending)', async () => {
      const autoMergeAttempt = {
        ...mockAttempt,
        validation_passed: null,
        repository: { ...mockAttempt.repository, auto_merge_enabled: true },
      };
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(autoMergeAttempt);

      await service.dispatch('pull_request_review', {
        action: 'submitted',
        review: { state: 'approved' },
        pull_request: { number: 42 },
      });
      expect(github.apiRequest).not.toHaveBeenCalled();
    });
  });

  describe('check_suite: completed success + auto_merge_enabled (CI-then-approve ordering)', () => {
    it('auto-merges when CI passes and a prior approval exists', async () => {
      const autoMergeAttempt = {
        ...mockAttempt,
        repository: { ...mockAttempt.repository, auto_merge_enabled: true },
      };
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(autoMergeAttempt);
      // First call = list reviews (returns approved), second call = merge
      (github.apiRequest as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => [{ state: 'APPROVED' }] })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      (prisma.bugFixAttempt.update as jest.Mock).mockResolvedValue(autoMergeAttempt);

      await service.dispatch('check_suite', {
        action: 'completed',
        check_suite: { conclusion: 'success', head_branch: 'autofix/bug-abc-def' },
      });

      expect(github.apiRequest).toHaveBeenCalledWith(
        1234,
        '/repos/acme/app/pulls/42/reviews',
      );
      expect(github.apiRequest).toHaveBeenCalledWith(
        1234,
        '/repos/acme/app/pulls/42/merge',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('does not merge when CI passes but no approval yet', async () => {
      const autoMergeAttempt = {
        ...mockAttempt,
        repository: { ...mockAttempt.repository, auto_merge_enabled: true },
      };
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(autoMergeAttempt);
      (github.apiRequest as jest.Mock).mockResolvedValue({ ok: true, json: async () => [{ state: 'COMMENTED' }] });
      (prisma.bugFixAttempt.update as jest.Mock).mockResolvedValue(autoMergeAttempt);

      await service.dispatch('check_suite', {
        action: 'completed',
        check_suite: { conclusion: 'success', head_branch: 'autofix/bug-abc-def' },
      });

      // reviews listed but merge NOT called
      expect(github.apiRequest).toHaveBeenCalledWith(
        1234,
        '/repos/acme/app/pulls/42/reviews',
      );
      expect(github.apiRequest).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('/merge'),
        expect.anything(),
      );
    });
  });

  describe('pull_request_review: changes_requested', () => {
    it('marks attempt failed', async () => {
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(mockAttempt);
      await service.dispatch('pull_request_review', {
        action: 'submitted',
        review: { state: 'changes_requested' },
        pull_request: { number: 42 },
      });
      expect(prisma.bugFixAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    });
  });

  describe('check_suite: completed', () => {
    it('marks validation_passed true on success', async () => {
      (prisma.bugFixAttempt.findFirst as jest.Mock).mockResolvedValue(mockAttempt);
      await service.dispatch('check_suite', {
        action: 'completed',
        check_suite: { conclusion: 'success', head_branch: 'autofix/bug-abc-def' },
      });
      expect(prisma.bugFixAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ validation_passed: true }) }),
      );
    });

    it('ignores non-autofix branches', async () => {
      await service.dispatch('check_suite', {
        action: 'completed',
        check_suite: { conclusion: 'failure', head_branch: 'main' },
      });
      expect(prisma.bugFixAttempt.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('unknown event', () => {
    it('does nothing for unhandled events', async () => {
      await service.dispatch('push', {});
      expect(prisma.bugFixAttempt.findFirst).not.toHaveBeenCalled();
    });
  });
});
