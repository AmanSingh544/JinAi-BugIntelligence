# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Bug Intelligence Platform** — an AI-powered browser observability system. A Chrome extension captures browser errors, a NestJS backend processes them through a BullMQ pipeline (ingest → error-detection → AI analysis → clustering → rule-evaluation → dispatch), and a React dashboard displays AI-analyzed bugs. The backend uses Claude (via Anthropic SDK) to generate structured bug summaries and vector embeddings for semantic clustering.

## Infrastructure Setup

```bash
docker compose up -d   # Start PostgreSQL (pgvector) + Redis
docker compose down    # Stop
```

## Backend Commands (`cd backend`)

```bash
npm run start:dev      # Dev server on http://localhost:4000
npm run build          # Compile TypeScript to dist/
npm run start:prod     # Production mode

npm run db:generate    # Generate Prisma client after schema changes
npm run db:migrate     # Create + apply migration (dev)
npm run db:deploy      # Apply migrations (production, no prompts)
npm run db:studio      # Open Prisma Studio GUI

npm run lint           # ESLint with auto-fix
npm run format         # Prettier
npm run test           # Jest unit tests
npm run test:watch     # Jest watch mode
npm run test:cov       # Coverage report
npm run test:e2e       # E2E tests (uses test/jest-e2e.json)
```

Run a single test file:
```bash
npm run test -- path/to/file.spec.ts
```

## Dashboard Commands (`cd dashboard`)

```bash
npm run dev            # Vite dev server on http://localhost:5173
npm run build          # Production build
npm run lint           # ESLint
npm run preview        # Preview production build
```

## Extension Commands (`cd extension`)

```bash
npm run dev            # Vite watch build (load dist/ in Chrome)
npm run build          # Production build
npm run typecheck      # TypeScript check without emit
```

## Backend Architecture

### Queue Pipeline

Events flow through six BullMQ queues in sequence:

```
POST /api/v1/ingest/batch
  → ingest queue → IngestWorker (saves events/sessions to DB)
  → error-detection queue → ErrorDetectionWorker (fingerprint + dedup via DB unique constraint)
  → ai-analysis queue → AiAnalysisWorker (calls Claude Haiku; generates Bug + vector embedding)
  → clustering queue → ClusteringWorker (pgvector KNN; updates ErrorCluster centroid)
  → rule-evaluation queue → RuleEvaluationWorker (matches project rules)
  → dispatch queue → DispatchWorker (calls IntegrationProvider; retries: 0s/30s/5m/30m/2h)
```

Queue payloads are lightweight (IDs + fingerprint only); workers fetch full context from the DB at runtime.

### Auth

- **Dashboard users**: JWT Bearer tokens (15m access + 7d refresh)
- **Extension**: `X-API-Key` header. Raw key shown once; SHA-256 hash stored in DB. Format: `bi_live_{64 hex chars}`
- Guards: `JwtAuthGuard`, `ApiKeyGuard` in `backend/src/shared/guards/`

### Integration Provider Pattern

Adding a new integration (e.g., Linear, Slack) means implementing `IntegrationProvider` in `backend/src/modules/integrations/providers/integration.interface.ts` and registering it in `integration.registry.ts`. Jira and GitHub providers exist as Phase 2 stubs.

### AI Configuration

The AI module (`backend/src/modules/ai-analysis/`) supports a fallback model chain. Configure via env:
- `AI_API_KEY` — Anthropic or OpenRouter key
- `AI_BASE_URL` — optional for OpenAI-compatible endpoints
- `AI_MODELS` — comma-separated fallback chain (e.g., `claude-haiku-4-5,google/gemini-2.0-flash-exp:free`)

### Key Database Constraints

- **Error dedup**: `UNIQUE (fingerprint, project_id, dedup_bucket)` — prevents duplicates without distributed locks
- **Vector embeddings**: `vector(1536)` columns on `ErrorCluster` for pgvector cosine similarity
- **Unique users**: counted as `COUNT(DISTINCT session_id)` — no PII stored

## Backend `.env` Reference

```env
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bug_intelligence?schema=public"
REDIS_URL="redis://localhost:6379"
ALLOWED_ORIGINS="http://localhost:5173"
JWT_SECRET="..."
JWT_EXPIRATION="15m"
JWT_REFRESH_SECRET="..."
JWT_REFRESH_EXPIRATION="7d"
AI_API_KEY="sk-..."
# AI_BASE_URL="https://openrouter.ai/api/v1"
AI_MODELS="claude-haiku-4-5-20251001"
MERIDIAN_BASE_URL="http://localhost:3000"
```

Copy `backend/.env.example` as the starting point.

## Code Conventions

- **ESLint**: flat config (`eslint.config.mjs`); TypeScript type-checking enabled; `no-explicit-any` is off, `no-floating-promises` is warn
- **Prettier**: `.prettierrc` with `endOfLine: auto`
- **Swagger**: auto-generated at `GET /api/docs` from NestJS decorators — keep DTOs annotated

## Phase Status

Phase 1 (complete): error capture, dedup, AI analysis, semantic clustering, rule engine, Meridian 3SC dispatch, JWT/API key auth, dashboard, Chrome extension.

Phase 2 (not yet built): session replay (rrweb), Jira/GitHub provider implementations, nested rule conditions, Slack/email notifications, AI debug chat.
