# Autonomous Bug-Fix Agent — Architecture & Implementation Plan

> Status: Approved architecture. Ready for Phase 0 implementation.
> Last updated: 2026-05-18

---

## 1. What This Builds

An autonomous pipeline that takes a Bug record (already AI-analyzed), fetches the relevant source file from GitHub, generates a targeted code fix using Claude, raises a PR, and optionally auto-merges it on human approval + CI green.

```
Existing pipeline:
  Capture → Ingest → Error Detection → AI Analysis → Rules → Dispatch

New extension (triggered by rule action auto_fix):
  fix-generation → fix-pr-creation → (webhook or poll) → merge
```

---

## 2. Core Architectural Decisions

### 2.1 Auth: GitHub App (not OAuth tokens)

Users install a GitHub App on their org/repo. The system receives an `installation_id` and exchanges it for short-lived (1-hour) installation access tokens via `POST /app/installations/{id}/access_tokens`. Tokens cached in Redis with 55-minute TTL (5-minute safety buffer).

**Never use user OAuth tokens for automated commits.** GitHub Apps appear as "bot" in Git history, have granular permissions, and can be revoked per-repo by users.

Required GitHub App permissions:
- Contents: Read & Write
- Pull Requests: Read & Write
- Statuses: Read
- Webhooks: Receive

### 2.2 AI Output: Structured JSON (not unified diff)

The fix generation LLM call returns:

```json
{
  "file": "src/services/auth.ts",
  "startLine": 44,
  "endLine": 47,
  "originalCode": "const session = createSession(user.id)",
  "fixedCode": "if (!user) throw new AuthError('Invalid token');\nconst session = createSession(user.id);",
  "explanation": "Added null guard before accessing user.id",
  "confidence": 0.92,
  "requiresMultipleFiles": false
}
```

Unified diffs are NOT used — they fail ~25-35% of the time when file context drifts.

**PatchApplicatorService** verifies `originalCode` exactly matches the actual file content at `startLine..endLine` before applying. If mismatch → attempt fails with reason `source_mismatch` (never silently applies wrong fix).

### 2.3 Source Path Resolution

Source map frame: `webpack:///src/services/auth.ts:44:22`
After normalization: `src/services/auth.ts`
GitHub API path: `{source_root_prefix}/{normalized_path}`

`source_root_prefix` handles monorepos:
- Standard repo: `""` → `src/services/auth.ts`
- Monorepo: `packages/web` → `packages/web/src/services/auth.ts`

Source content fetched via GitHub Contents API and cached in Redis keyed on commit SHA (auto-invalidates when branch advances).

### 2.4 Fix Prompt Strategy

**Key insight:** The AI analysis stage already computed `rootCause` and `fixSuggestion`. The fix generation prompt uses these as grounding — the LLM does not re-derive the problem, only writes the code.

Context provided to fix LLM:
- `error.message` + `error.stack_unminified`
- `bug.rootCause` + `bug.fixSuggestion` (from existing analysis)
- Full source file content (up to 4000 tokens; truncated to ±50 lines around error line if larger)
- File language (detected from extension)
- `requiresApproval` flag (tells AI to be conservative if human review required)

### 2.5 Rule Engine Integration

Fix generation is triggered by a new rule action: `auto_fix`.

Users configure rules such as:
```
IF severity IN [high, critical]
AND cluster.occurrence_count >= 3
THEN auto_fix
```

This ensures fixes are only attempted for recurring, high-impact bugs — not every noise event.

### 2.6 Idempotency

- Redis lock: `autofix:lock:{bugId}` (TTL 300s) — prevents concurrent fix attempts
- Before creating a PR: check for existing `BugFixAttempt` with `status NOT IN [failed, cancelled]` — skip if found
- Max attempts: 3 (configurable) — after max, set `Bug.fix_status = fix_failed` and notify

### 2.7 Webhook + Poll Hybrid

Webhook-first for speed, poll-as-fallback for reliability:
- `POST /webhooks/github` receives PR review and close events — triggers merge check immediately
- `FixPrMonitorWorker` runs every 5 minutes via BullMQ repeatable job — polls all `pr_open` attempts
- Merge happens in whichever path fires first (idempotency prevents double-merge)

**Correct GitHub webhook event names (from GitHub Docs):**
- PR approval: event = `pull_request_review`, type = `submitted`, payload field `review.state = "approved"`
  - NOT `pull_request.review_submitted` (that was wrong in earlier drafts)
- PR closed/merged: event = `pull_request`, type = `closed`, payload field `pull_request.merged = true`
- CI status: event = `check_suite`, type = `completed`

### 2.8 Attempt State Machine

Strict allowed transitions only — no arbitrary state jumps:

```
generating → validating → validated → pr_open → merged
    │              │           │          │
    └──────────────┴───────────┴──────────┴──→ failed
                                           │
                                           └──→ cancelled
```

**Allowed transitions:**
| From | To | Trigger |
|------|----|---------|
| generating | validating | Fix applied successfully |
| generating | failed | LLM error, gate failed, lock timeout |
| validating | validated | tsc/lint passed (Phase 4) |
| validating | failed | Validation failed |
| validated | pr_open | PR created on GitHub |
| validated | failed | GitHub API error |
| pr_open | merged | Webhook or poll confirms merge |
| pr_open | cancelled | Bug resolved manually / user cancels |
| pr_open | failed | Merge rejected (branch protection, conflict) |

No transition outside this table is permitted. State updates are atomic via Prisma transactions.

### 2.9 Source Drift Protection

Line-number replacement alone is fragile. Use file SHA for cache keying AND a two-level check:

1. **Cache key:** `github:source:{owner}:{repo}:{branch_sha}:{file_path}` — keyed on the branch's current commit SHA. When the branch advances (new push), SHA changes, cache miss → fresh fetch.
2. **`originalCode` exact-match:** Before applying the fix, the `PatchApplicatorService` verifies the slice `file_lines[startLine-1..endLine-1].join('\n')` exactly equals `originalCode` from the AI response. If mismatch → `status = failed`, `failure_reason = source_mismatch`.
3. **Base branch SHA lock:** When creating the PR branch, record the `base_sha` at branch creation time. If the base branch has advanced before the PR is merged, GitHub will show "branch is out of date" — surface this to the user rather than force-merging.

### 2.10 Manual Path Override

Source maps are not always accurate (custom webpack config, path rewriting, etc.). The `ProjectRepository` model includes a `path_overrides` JSON field:

```json
{
  "path_overrides": {
    "webpack:///./src/": "src/",
    "webpack:///node_modules/": null
  }
}
```

Rules: key = prefix to match in raw source path, value = replacement prefix (null = skip this frame, don't attempt fix). Applied before `source_root_prefix` concatenation. Exposed in Settings UI as an "Advanced path mapping" editor.

### 2.11 GitHub API Rate Limiting

GitHub Apps get 5,000 API points/hour per installation. At scale (multiple projects sharing one installation), this can be exhausted.

**Implementation:** Per-installation Redis token bucket:
- Key: `github:ratelimit:{installation_id}`
- Capacity: 4,500 (leave 500 buffer)
- Refill: 4,500 per hour
- Consume: 1 point per API call (conservative; most calls cost 1)
- On bucket empty: exponential backoff starting at 60s, max 1 hour
- On GitHub 429 response: respect `Retry-After` header, update bucket to 0

**Retry policy for GitHub API calls:**
- Attempt 1: immediate
- Attempt 2: 30s
- Attempt 3: 5 minutes
- Attempt 4: 30 minutes
- After 4 attempts: mark as `failed`, notify user

---

## 3. New Database Models

```prisma
model ProjectRepository {
  id                   String   @id @default(uuid()) @db.Uuid
  project_id           String   @db.Uuid @unique
  github_owner         String
  github_repo          String
  default_branch       String   @default("main")
  source_root_prefix   String   @default("")
  installation_id      Int
  webhook_secret       String
  path_overrides       Json     @default("{}")        // {"webpack:///./src/": "src/"} — see section 2.10
  merge_strategy       String   @default("squash")   // squash | merge | rebase
  auto_merge_enabled   Boolean  @default(false)
  min_severity         String   @default("high")
  fix_confidence_min   Float    @default(0.75)
  created_at           DateTime @default(now())
  project              Project  @relation(...)
}

model BugFixAttempt {
  id               String    @id @default(uuid()) @db.Uuid
  bug_id           String    @db.Uuid
  attempt_number   Int
  status           String    // generating | validating | pr_open | merged | failed | cancelled

  target_file      String?
  start_line       Int?
  end_line         Int?
  original_code    String?   @db.Text
  fixed_code       String?   @db.Text
  fix_explanation  String?   @db.Text
  fix_confidence   Float?

  branch_name      String?
  pr_number        Int?
  pr_url           String?
  pr_merged_at     DateTime?

  validation_passed  Boolean?
  validation_output  String?  @db.Text

  failure_reason   String?
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt

  bug              Bug       @relation(...)

  @@unique([bug_id, attempt_number])
  @@index([bug_id, status])
  @@index([status, pr_number])
}

// Bug model additions:
// fix_status   String?   // null | fix_pending | fix_failed | pr_open | pr_merged
```

---

## 4. New Module Structure

```
backend/src/modules/
├── autofix/
│   ├── autofix.module.ts
│   ├── fix-generation.queue.ts        BullMQ queue (concurrency: 1, attempts: 2, backoff: 60s)
│   ├── fix-generation.worker.ts       Core fix logic
│   ├── fix-pr-creation.queue.ts
│   ├── fix-pr-creation.worker.ts
│   ├── fix-pr-monitor.queue.ts        Repeatable job every 5 min
│   ├── fix-pr-monitor.worker.ts
│   ├── github-app.service.ts          Token fetch + Redis cache
│   ├── source-fetcher.service.ts      GitHub Contents API + cache
│   ├── fix-prompt.service.ts          Prompt construction
│   ├── patch-applicator.service.ts    JSON fix → file content
│   └── autofix.controller.ts          REST: attempts CRUD
│
├── webhooks/
│   ├── webhooks.module.ts
│   ├── webhooks.controller.ts         POST /webhooks/github
│   └── github-webhook.service.ts      HMAC verify + event routing
│
└── project-repositories/
    ├── project-repositories.module.ts
    ├── project-repositories.service.ts
    ├── project-repositories.controller.ts
    └── dto/
        ├── connect-repository.dto.ts
        └── update-repository.dto.ts
```

---

## 5. New API Endpoints

```
# Repository connection
POST   /api/v1/projects/:projectId/repository     Connect GitHub repo
GET    /api/v1/projects/:projectId/repository     Get repo config
PATCH  /api/v1/projects/:projectId/repository     Update settings
DELETE /api/v1/projects/:projectId/repository     Disconnect

# GitHub App install
GET    /api/v1/github-app/install-url             Returns GitHub App install URL
GET    /api/v1/github-app/callback                Receives installation_id from GitHub

# Fix attempts
GET    /api/v1/bugs/:bugId/fix-attempts           List attempts
POST   /api/v1/bugs/:bugId/fix-attempts           Manual trigger
PATCH  /api/v1/bugs/:bugId/fix-attempts/:id/cancel  Cancel attempt

# Webhook (HMAC-verified, no auth guard)
POST   /webhooks/github                           GitHub App event receiver
```

---

## 6. End-to-End Data Flow

```
1. Bug created by existing AI analysis pipeline

2. RuleEvaluationWorker: rule matches with action=auto_fix
   → Queue: fix-generation { bugId, projectId, errorId, requireApproval }

3. FixGenerationWorker:
   a. Load Bug (rootCause, fixSuggestion, ai_confidence, severity)
   b. Gate: confidence >= fix_confidence_min AND severity >= min_severity
   c. Gate: ProjectRepository exists
   d. Acquire Redis lock: autofix:lock:{bugId}
   e. Create BugFixAttempt (status=generating)
   f. Load Error → get release → get sourcemaps → resolve file path
   g. Fetch source file (SourceFetcherService, cached)
   h. Build prompt (existing analysis as hints + source content)
   i. Call Claude → structured JSON fix
   j. Verify originalCode matches file (exact match)
   k. Apply fix (line replacement)
   l. Update BugFixAttempt (status=validating)
   m. [Phase 4: tsc in Docker sandbox]
   n. Update BugFixAttempt (status=validated, fix content stored)
   o. Queue: fix-pr-creation { bugId, attemptId }
   p. Release lock

4. FixPrCreationWorker:
   a. Load attempt + bug + repo config
   b. Get installation token (GitHubAppService)
   c. Get current SHA of default_branch
   d. Create branch: bugfix/bug-{bugId}-{attemptNumber}
   e. Create file commit with fixed content
   f. Open PR: title + structured body
   g. Add labels: bug-intelligence-fix, severity-{level}
   h. Update attempt: pr_number, pr_url, status=pr_open
   i. Update bug: fix_status=pr_open
   j. SSE broadcast + in-app notification

5a. Webhook path (fast):
    POST /webhooks/github → pull_request.review_submitted (approved)
    → Lookup attempt by pr_number
    → If auto_merge_enabled AND CI green → POST /pulls/{pr_number}/merge
    → Update attempt: status=merged, pr_merged_at
    → Update bug: fix_status=pr_merged

5b. Poll fallback (every 5 min):
    FixPrMonitorWorker queries all pr_open attempts
    → Same merge logic as webhook path

6. If bug resolved manually while PR open:
   → Close PR via GitHub API (PATCH /pulls/{pr_number} { state: 'closed' })
   → Update attempt: status=cancelled
```

---

## 7. Phase-wise Implementation

### Phase 0 — Foundation (Weeks 1-2, 4 dev-weeks)
> GitHub App connection + source file fetching. No AI yet.

**Backend:**
- `ProjectRepository` Prisma model + migration
- `BugFixAttempt` Prisma model + migration
- `Bug.fix_status` field + migration
- `project-repositories` module: CRUD + DTOs
- `GitHubAppService`: installation token fetch, Redis cache (55-min TTL)
- `SourceFetcherService`: Contents API + Redis cache by commit SHA + path resolution
- GitHub App created in GitHub settings
- Env vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_WEBHOOK_SECRET`
- `/api/v1/github-app/install-url` + `/callback` endpoints

**Dashboard:**
- Settings: "GitHub Repository" section
- GitHub App install flow
- Repo config form (branch, prefix, merge strategy, auto-merge toggle)

**Done when:** Can connect repo, fetch a specific file by source-map-derived path (including path override mapping), see it in logs. Source cache keyed on branch commit SHA confirmed working.

---

### Phase 1 — Fix Generation (Weeks 3-4, 4 dev-weeks)
> AI generates a fix and stores it. No PR yet.

**Backend:**
- `autofix` module scaffold
- `fix-generation.queue.ts` (concurrency: 1, max attempts: 2, backoff: 60s exponential)
- `FixGenerationWorker`: full flow
- `FixPromptService`: prompt with existing Bug analysis as hints
- `PatchApplicatorService`: apply structured JSON fix + originalCode verification
- Rule engine: `auto_fix` action in `RuleEvaluationWorker`
- `BugFixAttempt` service
- `GET /bugs/:bugId/fix-attempts` + `POST /bugs/:bugId/fix-attempts`

**Dashboard:**
- Bug detail: "Auto-Fix" tab (status, diff preview — read-only)
- Rules page: "Auto-Fix Bug" action option

**Done when:** End-to-end test generates correct fix diff in staging, originalCode mismatch handled gracefully.

---

### Phase 2 — PR Creation (Week 5, 1 dev-week)
> Fix goes to GitHub as a real PR.

**Backend:**
- `fix-pr-creation.queue.ts` + `FixPrCreationWorker`
- Branch creation, file commit, PR open, labels
- PR body template (root cause, what changed, test plan checklist)
- `BugFixAttempt` PR details updated
- SSE broadcast + in-app notification: "PR raised"
- Edge cases: branch already exists, file >1MB, repo not found

**Dashboard:**
- Bug detail: PR link, "View on GitHub" button
- Notification: "PR raised" type

**Done when:** Real PR appears on GitHub repo from a staging bug.

---

### Phase 3 — Review & Merge (Week 6, 1 dev-week)
> Webhook receiver + poll fallback + merge.

**Backend:**
- `webhooks` module
- `GitHubWebhookController`: HMAC-SHA256 verification (X-Hub-Signature-256 header) + event routing
- `GitHubWebhookService`:
  - Event `pull_request_review` type `submitted` → check `review.state === 'approved'`
  - Event `pull_request` type `closed` → check `pull_request.merged`
  - Event `check_suite` type `completed` → update CI status on attempt
- `fix-pr-monitor.queue.ts` + repeatable job (every 5 min)
- `FixPrMonitorWorker`: poll open PRs, check reviews + CI via GitHub API, merge logic
- Merge strategy: squash/merge/rebase from `ProjectRepository.merge_strategy`
- Handle branch protection failures (403/422 from merge API) → mark `failed`, surface to user
- Handle merge conflicts → mark `failed`, `failure_reason = merge_conflict`, notify
- Bug resolved → close open PR
- Rate limiting: per-installation Redis token bucket (section 2.11)
- Explicit GitHub API retry backoff (4 attempts: 0s/30s/5m/30m)
- `PATCH /bugs/:bugId/fix-attempts/:id/cancel`
- State machine: only allow transitions listed in section 2.8

**Dashboard:**
- Bug detail: "Approve & Merge" manual button
- PR review status (approvals count, CI status)
- Attempt timeline

**Done when:** PR auto-merges after GitHub approval on staging.

---

### Phase 4 — Hardening (Weeks 7-8, 4 dev-weeks)
> Production-ready: sandbox, observability, edge cases.

**Backend:**
- Docker sandbox sidecar for `tsc --noEmit` + ESLint (isolated network, read-only mounts, seccomp, timeout 30s)
- Max attempt enforcement + DLQ notification
- Stale PR detection (>7 days open → notify + optional auto-close)
- Source cache invalidation hook in `SourcemapUploadService` on new release
- Prometheus metrics: `autofix_generated_total`, `autofix_applied_total`, `autofix_pr_opened_total`, `autofix_merged_total`, `autofix_failed_total`
- Audit log entries for all fix actions
- Alert: fix_confidence < 0.6 AND fix attempted → audit flag

**Dashboard:**
- Metrics: fix success rate, time-to-fix, merged count
- Settings: max attempts, confidence threshold, severity threshold
- Admin: all active fix attempts across projects

**Done when:** Load tested, metrics visible in dashboard, sandbox validated against injection attempts.

---

## 8. Effort Summary

| Phase | Focus | Duration | Dev-weeks |
|-------|-------|----------|-----------|
| 0 | GitHub connection + source fetch | 2 weeks | 4 |
| 1 | AI fix generation (local only) | 2 weeks | 4 |
| 2 | PR creation | 1 week | 1 |
| 3 | Review + merge | 1 week | 1 |
| 4 | Hardening + sandbox | 2 weeks | 4 |
| **Total** | | **8 weeks** | **14** |

---

## 9. Invariants (must never be violated)

1. Never commit directly to `default_branch`. Always use a feature branch.
2. Never auto-merge unless `auto_merge_enabled = true` on `ProjectRepository`.
3. Never start a new fix attempt if one exists with `status NOT IN [failed, cancelled]`.
4. Always verify `originalCode` matches file content before applying any fix.
5. Always verify HMAC-SHA256 on every webhook request before processing.
6. All GitHub API calls use installation tokens — never user OAuth tokens.
7. All fix operations are tenant-isolated: verify `bug.project.tenant_id` before acting.

---

## 10. Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Source path mismatch (monorepo) | High | `source_root_prefix` config + validation step in Phase 0 |
| AI fix is semantically wrong | Medium | Human review by default; auto-merge opt-in only |
| `originalCode` mismatch (source drifted) | Medium | Fail explicitly, mark attempt failed, notify |
| GitHub rate limit (5000/hr) | Low | Redis token bucket per installation |
| PR on protected branch (no permission) | Low | Detect 422, surface config error to user |
| GitHub App uninstalled mid-flow | Low | Catch 401/403, mark fix_failed, clean up |
| Sandbox escape (Phase 4) | Very Low | Isolated Docker network, seccomp, read-only mounts, timeout |

---

## 11. Out of Scope (deliberate)

| Feature | Reason |
|---------|--------|
| Multi-file fixes | Phase 2+; 80% of bugs are single-file |
| Test generation | Adds 3+ weeks; separate feature |
| GitLab / Bitbucket | Phase 3+; GitHub first |
| AI-generated PR reviews | Feature creep |
| CD pipeline integration | Out of platform scope |

---

## 12. New Environment Variables

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET="random-32-byte-hex"
AUTOFIX_MAX_ATTEMPTS=3
AUTOFIX_FIX_CONFIDENCE_MIN=0.75
AUTOFIX_SANDBOX_ENABLED=false     # true in Phase 4
AUTOFIX_SANDBOX_TIMEOUT_MS=30000
```
