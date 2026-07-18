import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { SourceMapConsumer } from 'source-map';
import { readFile } from 'fs/promises';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { FixGenerationJob, FIX_GENERATION_QUEUE } from './fix-generation.queue';
import { FixPromptService } from './fix-prompt.service';
import { PatchApplicatorService } from './patch-applicator.service';
import { FixValidatorService } from './fix-validator.service';
import { SourceFetcherService } from './source-fetcher.service';
import { FixPrQueue } from './fix-pr.queue';

const AUTOFIX_LOCK_PREFIX = 'autofix:lock:';
const AUTOFIX_LOCK_TTL = 300; // 5 minutes
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

@Injectable()
export class FixGenerationWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<FixGenerationJob>;
  private readonly logger = new Logger(FixGenerationWorker.name);
  private readonly ai: OpenAI;
  private readonly models: string[];
  private readonly maxAttempts: number;
  private readonly minConfidence: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly promptService: FixPromptService,
    private readonly patchApplicator: PatchApplicatorService,
    private readonly fixValidator: FixValidatorService,
    private readonly sourceFetcher: SourceFetcherService,
    private readonly prQueue: FixPrQueue,
  ) {
    this.ai = new OpenAI({
      apiKey: this.config.get<string>('AI_API_KEY') ?? '',
      baseURL: this.config.get<string>('AI_BASE_URL'),
      defaultHeaders: {
        'HTTP-Referer': 'https://bug-intelligence.local',
        'X-Title': 'Bug Intelligence Autofix',
      },
    });
    const modelsEnv =
      this.config.get<string>('AI_MODELS') ??
      this.config.get<string>('AI_MODEL') ??
      'gpt-4o-mini';
    this.models = modelsEnv
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    this.maxAttempts = parseInt(
      this.config.get<string>('AUTOFIX_MAX_ATTEMPTS') ?? '3',
      10,
    );
    this.minConfidence = parseFloat(
      this.config.get<string>('AUTOFIX_FIX_CONFIDENCE_MIN') ?? '0.75',
    );
  }

  onModuleInit() {
    this.worker = new Worker<FixGenerationJob>(
      FIX_GENERATION_QUEUE,
      async (job: Job<FixGenerationJob>) => this.process(job),
      { connection: this.redis, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Fix generation job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<FixGenerationJob>) {
    return this.metrics.wrapJob('fix-generation', async () => {
      const { bugId, projectId, requireApproval } = job.data;
      this.logger.log(`Fix generation started for bug=${bugId}`);

      // ── 1. Load bug + validate it's still fix-worthy ─────────────────────
      const bug = await this.prisma.bug.findUnique({
        where: { id: bugId, project_id: projectId },
        include: {
          error: { include: { release: { include: { sourcemaps: true } } } },
        },
      });
      if (!bug)
        return this.logger.warn(
          `Bug ${bugId} not found in project=${projectId} — skipping`,
        );
      if (bug.status === 'resolved' || bug.status === 'ignored') {
        return this.logger.log(`Bug ${bugId} is ${bug.status} — skipping fix`);
      }

      // ── 2. Load repository config ─────────────────────────────────────────
      const repo = await this.prisma.projectRepository.findUnique({
        where: { project_id: projectId },
      });
      if (!repo) {
        return this.logger.warn(
          `No repository connected for project=${projectId}`,
        );
      }

      // ── 3. Severity + confidence gates ────────────────────────────────────
      const minSevIdx = SEVERITY_ORDER.indexOf(repo.min_severity);
      const bugSevIdx = SEVERITY_ORDER.indexOf(bug.severity ?? 'low');
      if (bugSevIdx < minSevIdx) {
        this.logger.log(
          `Bug ${bugId} severity=${bug.severity} below threshold=${repo.min_severity} — skipping`,
        );
        return;
      }
      if (
        bug.ai_confidence !== null &&
        bug.ai_confidence < repo.fix_confidence_min
      ) {
        this.logger.log(
          `Bug ${bugId} confidence=${bug.ai_confidence} below threshold=${repo.fix_confidence_min} — skipping`,
        );
        return;
      }

      // ── 4. Check attempt limit ────────────────────────────────────────────
      const attemptCount = await this.prisma.bugFixAttempt.count({
        where: { bug_id: bugId },
      });
      if (attemptCount >= this.maxAttempts) {
        this.logger.warn(
          `Bug ${bugId} reached max fix attempts (${this.maxAttempts})`,
        );
        await this.prisma.bug.update({
          where: { id: bugId },
          data: { fix_status: 'fix_failed' },
        });
        return;
      }

      // ── 5. Acquire Redis lock (prevents concurrent attempts) ──────────────
      const lockKey = `${AUTOFIX_LOCK_PREFIX}${bugId}`;
      const locked = await this.redis.set(
        lockKey,
        '1',
        'EX',
        AUTOFIX_LOCK_TTL,
        'NX',
      );
      if (!locked) {
        this.logger.debug(`Lock held for bug=${bugId} — skipping duplicate`);
        return;
      }

      // ── 6. Create attempt record ──────────────────────────────────────────
      const attempt = await this.prisma.bugFixAttempt.create({
        data: {
          bug_id: bugId,
          repository_id: repo.id,
          attempt_number: attemptCount + 1,
          status: 'generating',
        },
      });

      try {
        // ── 7. Resolve source file from stack trace ───────────────────────
        const { filePath, errorLine } = await this.resolveSourceFrame(
          bug.error,
        );
        if (!filePath || errorLine === null) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            'Could not resolve source file from stack trace',
          );
        }

        // ── 8. Fetch source file from GitHub ──────────────────────────────
        let sourceCtx;
        try {
          sourceCtx = await this.sourceFetcher.fetchSourceForFrame(
            filePath,
            errorLine,
            repo,
          );
        } catch (err) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            `Source fetch failed: ${(err as Error).message}`,
          );
        }

        // ── 9. Build prompt + call AI ─────────────────────────────────────
        const language = this.promptService.detectLanguage(sourceCtx.file.path);
        const userPrompt = this.promptService.buildUserPrompt({
          errorMessage: bug.error.message,
          stackTrace: bug.error.stack_unminified ?? bug.error.stack ?? '',
          rootCause: bug.root_cause ?? '',
          fixSuggestion: bug.fix_suggestion ?? '',
          targetFile: sourceCtx.file.path,
          fileContent: sourceCtx.file.content,
          errorLine,
          language,
          requiresApproval: requireApproval,
        });

        const aiText = await this.callWithFallback(
          this.promptService.systemPrompt,
          userPrompt,
        );
        if (!aiText) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            'All AI models exhausted',
          );
        }

        // ── 10. Parse AI response ─────────────────────────────────────────
        const fixResult = this.promptService.parseAiResponse(aiText);
        if (!fixResult) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            'AI response could not be parsed as valid fix JSON',
          );
        }

        if (fixResult.confidence < this.minConfidence) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            `AI confidence ${fixResult.confidence} below threshold ${this.minConfidence}`,
          );
        }

        if (fixResult.requiresMultipleFiles) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            'Fix requires multiple files — not supported in Phase 1 (single-file only)',
          );
        }

        // ── 11. Update attempt with validating status ─────────────────────
        await this.prisma.bugFixAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'validating',
            target_file: fixResult.file,
            start_line: fixResult.startLine,
            end_line: fixResult.endLine,
            original_code: fixResult.originalCode,
            fixed_code: fixResult.fixedCode,
            fix_explanation: fixResult.explanation,
            fix_confidence: fixResult.confidence,
          },
        });

        // ── 12. Apply patch (exact-match safety check) ────────────────────
        const applyResult = this.patchApplicator.apply(
          sourceCtx.file.content,
          fixResult,
        );
        if (!applyResult.success) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            `Patch apply failed (${applyResult.reason}): ${applyResult.detail}`,
          );
        }

        // ── 12b. Syntax-check the patched file before it becomes a PR ─────
        const validation = this.fixValidator.validate(
          fixResult.file,
          applyResult.newContent,
        );
        if (!validation.ok) {
          return await this.failAttempt(
            attempt.id,
            bugId,
            `Patched file failed syntax validation: ${validation.errors.join('; ')}`,
          );
        }

        // ── 13. Mark validated — ready for PR creation ────────────────────
        await this.prisma.bugFixAttempt.update({
          where: { id: attempt.id },
          data: { status: 'validated', validation_passed: true },
        });
        await this.prisma.bug.update({
          where: { id: bugId },
          data: { fix_status: 'fix_pending' },
        });

        this.logger.log(
          `Fix validated for bug=${bugId} attempt=${attempt.id} ` +
            `file=${fixResult.file} lines=${fixResult.startLine}-${fixResult.endLine} ` +
            `confidence=${fixResult.confidence}`,
        );

        // Enqueue PR creation
        await this.prQueue.add({ attemptId: attempt.id, bugId, projectId });
      } catch (err) {
        await this.failAttempt(
          attempt.id,
          bugId,
          `Unexpected error: ${(err as Error).message}`,
        );
        throw err; // Let BullMQ retry
      } finally {
        await this.redis.del(lockKey);
      }
    });
  }

  // ── Resolve the primary source file path + line from the unminified stack ──

  private async resolveSourceFrame(error: {
    stack_unminified: string | null;
    stack: string | null;
    release: {
      sourcemaps: {
        sourcemap_path: string;
        minified_filename: string;
        sourcemap_parsed: boolean;
      }[];
    } | null;
  }): Promise<{ filePath: string | null; errorLine: number | null }> {
    const stack = error.stack_unminified ?? error.stack ?? '';
    if (!stack) return { filePath: null, errorLine: null };

    // Parse first meaningful frame from the unminified stack
    const frameRegex =
      /at\s+(?:\S+\s+)?\(?([\w./\-@:]+\.(?:ts|tsx|js|jsx|vue|svelte)):(\d+):\d+\)?/;
    const match = stack.match(frameRegex);
    if (match?.[1] && match?.[2]) {
      return { filePath: match[1], errorLine: parseInt(match[2], 10) };
    }

    // Fallback: try to resolve from minified stack + sourcemap
    if (error.release?.sourcemaps?.length) {
      const parsed = await this.resolveFromSourcemap(
        error.stack ?? '',
        error.release.sourcemaps,
      );
      if (parsed) return parsed;
    }

    return { filePath: null, errorLine: null };
  }

  private async resolveFromSourcemap(
    minifiedStack: string,
    sourcemaps: {
      sourcemap_path: string;
      minified_filename: string;
      sourcemap_parsed: boolean;
    }[],
  ): Promise<{ filePath: string; errorLine: number } | null> {
    const frameMatch = minifiedStack.match(
      /at\s+(?:\S+\s+)?\(?([^:]+):(\d+):(\d+)\)?/,
    );
    if (!frameMatch) return null;

    const [, rawFile, lineStr, colStr] = frameMatch;
    const filename = rawFile.split('/').pop() ?? rawFile;
    const record = sourcemaps.find(
      (s) => s.sourcemap_parsed && s.minified_filename === filename,
    );
    if (!record) return null;

    try {
      const raw = await readFile(record.sourcemap_path, 'utf-8');
      const consumer = await new SourceMapConsumer(raw);
      const pos = consumer.originalPositionFor({
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
      });
      consumer.destroy();
      if (pos.source && pos.line) {
        const cleanPath = pos.source
          .replace(/^webpack:\/\/\//, '')
          .replace(/^\.\//, '');
        return { filePath: cleanPath, errorLine: pos.line };
      }
    } catch {
      // sourcemap unreadable — skip
    }
    return null;
  }

  // ── LLM call with model fallback chain ────────────────────────────────────

  private async callWithFallback(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    for (const model of this.models) {
      try {
        const response = await this.ai.chat.completions.create({
          model,
          max_tokens: 1500,
          temperature: 0.1, // Low temperature for deterministic code fixes
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
        const text = response.choices[0]?.message.content ?? '';
        if (text) {
          this.logger.debug(`Fix model ${model} succeeded`);
          return text;
        }
      } catch (err) {
        const e = err as Error & { status?: number };
        this.logger.warn(
          `Fix model ${model} failed [${e.status ?? '?'}]: ${e.message} — trying next`,
        );
      }
    }
    return null;
  }

  // ── Mark attempt as failed ────────────────────────────────────────────────

  private async failAttempt(attemptId: string, bugId: string, reason: string) {
    this.logger.warn(`Fix attempt ${attemptId} failed: ${reason}`);
    await this.prisma.bugFixAttempt.update({
      where: { id: attemptId },
      data: { status: 'failed', failure_reason: reason },
    });

    // Check if we've now exhausted all attempts
    const remaining = await this.prisma.bugFixAttempt.count({
      where: { bug_id: bugId, status: { notIn: ['failed', 'cancelled'] } },
    });
    if (remaining === 0) {
      const total = await this.prisma.bugFixAttempt.count({
        where: { bug_id: bugId },
      });
      if (total >= this.maxAttempts) {
        await this.prisma.bug.update({
          where: { id: bugId },
          data: { fix_status: 'fix_failed' },
        });
      }
    }
  }
}
