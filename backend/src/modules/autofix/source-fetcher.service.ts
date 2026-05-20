import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { GitHubAppService } from './github-app.service';
import type { ProjectRepository } from '@prisma/client';

const SOURCE_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours, keyed by commit SHA
const MAX_FILE_SIZE_BYTES = 1_000_000; // 1 MB — skip files larger than this

export interface FetchedSource {
  content: string;       // full file content
  sha: string;           // blob SHA (used for update commits)
  path: string;          // resolved GitHub path
  lines: string[];       // pre-split for line extraction
}

export interface SourceContext {
  file: FetchedSource;
  snippet: string;       // ±30 lines around the error line
  snippetStartLine: number;
}

@Injectable()
export class SourceFetcherService {
  private readonly logger = new Logger(SourceFetcherService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly githubApp: GitHubAppService,
  ) {}

  // ─── Resolve raw source-map path to GitHub repo path ─────────────────────

  resolveFilePath(rawSourcePath: string, repo: ProjectRepository): string {
    const overrides = (repo.path_overrides ?? {}) as Record<string, string | null>;

    // Apply path_overrides in definition order — first match wins
    for (const [prefix, replacement] of Object.entries(overrides)) {
      if (rawSourcePath.startsWith(prefix)) {
        if (replacement === null) {
          throw new Error(`Source path ${rawSourcePath} is excluded by path_overrides`);
        }
        rawSourcePath = replacement + rawSourcePath.slice(prefix.length);
        break;
      }
    }

    // Strip common bundler prefixes
    rawSourcePath = rawSourcePath
      .replace(/^webpack:\/\/\//, '')
      .replace(/^vite:\/\/\//, '')
      .replace(/^\.\//, '')
      .replace(/[?#].*$/, '');

    // Apply source_root_prefix for monorepos
    const prefix = repo.source_root_prefix?.trim();
    if (prefix) {
      return `${prefix}/${rawSourcePath}`;
    }
    return rawSourcePath;
  }

  // ─── Fetch branch HEAD SHA (cached briefly) ───────────────────────────────

  async getBranchSha(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const cacheKey = `github:branch-sha:${owner}:${repo}:${branch}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const response = await this.githubApp.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to get branch SHA for ${owner}/${repo}@${branch}: ${response.status}`);
    }

    const data = (await response.json()) as { object: { sha: string } };
    const sha = data.object.sha;
    // Cache branch SHA for 5 minutes — short TTL since branch advances with new commits
    await this.redis.setex(cacheKey, 300, sha);
    return sha;
  }

  // ─── Fetch source file content (cached by commit SHA + path) ─────────────

  async fetchFile(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<FetchedSource> {
    // Get commit SHA for this ref to use as stable cache key
    const branchSha = ref.length === 40 ? ref : await this.getBranchSha(installationId, owner, repo, ref);
    const cacheKey = `github:source:${owner}:${repo}:${branchSha}:${path}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as FetchedSource;
      parsed.lines = parsed.content.split('\n');
      return parsed;
    }

    const response = await this.githubApp.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branchSha}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found in repo: ${path} (ref=${branchSha})`);
      }
      throw new Error(`GitHub Contents API error [${response.status}] for ${path}`);
    }

    const data = (await response.json()) as {
      content: string;
      encoding: string;
      sha: string;
      size: number;
    };

    if (data.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large to fetch: ${path} (${data.size} bytes)`);
    }

    if (data.encoding !== 'base64') {
      throw new Error(`Unexpected encoding ${data.encoding} for ${path}`);
    }

    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');

    const result: FetchedSource = {
      content,
      sha: data.sha,
      path,
      lines: content.split('\n'),
    };

    // Store without lines array (recomputed on read)
    const toCache = { content, sha: data.sha, path, lines: [] };
    await this.redis.setex(cacheKey, SOURCE_CACHE_TTL_SECONDS, JSON.stringify(toCache));
    this.logger.debug(`Fetched ${path} from ${owner}/${repo}@${branchSha} (${content.length} chars)`);

    return result;
  }

  // ─── Extract snippet around error line ───────────────────────────────────

  extractSnippet(file: FetchedSource, errorLine: number, contextLines = 30): SourceContext {
    const startLine = Math.max(1, errorLine - contextLines);
    const endLine = Math.min(file.lines.length, errorLine + contextLines);
    const snippet = file.lines
      .slice(startLine - 1, endLine)
      .map((l, i) => `${startLine + i}: ${l}`)
      .join('\n');

    return { file, snippet, snippetStartLine: startLine };
  }

  // ─── Full fetch + resolve for a stack frame ───────────────────────────────

  async fetchSourceForFrame(
    rawSourcePath: string,
    errorLine: number,
    repo: ProjectRepository,
  ): Promise<SourceContext> {
    const resolvedPath = this.resolveFilePath(rawSourcePath, repo);

    const file = await this.fetchFile(
      repo.installation_id,
      repo.github_owner,
      repo.github_repo,
      resolvedPath,
      repo.default_branch,
    );

    return this.extractSnippet(file, errorLine);
  }

  // ─── Invalidate source cache for a repo branch (call on new release upload) ─

  async invalidateBranchCache(owner: string, repo: string, branch: string): Promise<void> {
    const branchKey = `github:branch-sha:${owner}:${repo}:${branch}`;
    await this.redis.del(branchKey);
    this.logger.debug(`Invalidated branch SHA cache for ${owner}/${repo}@${branch}`);
  }
}
