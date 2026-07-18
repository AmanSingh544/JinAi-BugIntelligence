# Bug Intelligence Platform — Full Setup Guide

---

## Prerequisites

- **Docker Desktop** (running)
- **Node.js 20+**
- **Chrome browser**
- An **AI API key** — free OpenRouter key at https://openrouter.ai OR Anthropic key at https://console.anthropic.com

---

## Step 1 — Start Infrastructure

From the project root (`JinnAi`):

```bash
docker compose up -d
```

Starts:

| Service    | Port  | Notes                         |
|------------|-------|-------------------------------|
| PostgreSQL | 5432  | With pgvector extension       |
| Redis      | 6379  |                               |
| Prometheus | 9090  | No login required             |
| Grafana    | 3001  | Login: `admin` / `admin`      |

---

## Step 2 — Configure Backend (one-time)

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and set **at minimum**:

```env
JWT_SECRET="any-long-random-string-at-least-32-chars"

# Option A — OpenRouter (free models, recommended)
AI_API_KEY="sk-or-..."
AI_BASE_URL="https://openrouter.ai/api/v1"
AI_MODELS="google/gemini-2.0-flash-exp:free,google/gemini-2.5-pro-exp-03-25:free,meta-llama/llama-4-scout:free"

# Option B — Anthropic directly
AI_API_KEY="sk-ant-..."
AI_BASE_URL="https://api.anthropic.com/v1"
AI_MODELS="claude-haiku-4-5-20251001"
```

Everything else (DATABASE_URL, REDIS_URL, PORT) is already set correctly in `.env.example` for local dev.

---

## Step 3 — Install Dependencies & Run Migrations (one-time)

```bash
# Still in backend/
npm install
npm run db:generate
npm run db:migrate
```

---

## Step 4 — Start the Backend

```bash
# In backend/
npm run start:dev
```

- API: http://localhost:4000
- Swagger docs: http://localhost:4000/api

---

## Step 5 — Start the Dashboard

Open a new terminal:

```bash
cd dashboard
npm install
npm run dev
```

Dashboard: http://localhost:5173

---

## Step 6 — First-Time Account & Project Setup

1. Open http://localhost:5173 → click **Register** → create your account
2. Create a **Project** → copy the API key shown (`bi_live_...`) — **it is shown only once**
3. Keep the project ID visible in the URL (you'll need it for release uploads)

---

## Step 7 — Build & Load the Chrome Extension (one-time)

```bash
cd extension
npm install
npm run build
```

In Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/dist/` folder
4. Click the extension icon in the toolbar
5. Paste your project API key (`bi_live_...`) → click **Start Capture**

The extension now captures errors, clicks, network calls, and console logs from any tab where it is active and sends them to the backend pipeline.

---

## Step 8 — Upload a Release & Sourcemaps (REQUIRED for unminified stack traces)

This is the step that links your production/staging build to the platform so stack traces are de-minified in the Bug detail view.

> **Note on the Dashboard UI:** The Releases tab in the dashboard is **read-only** — it shows releases and their sourcemap parse status. There is no upload form in the UI. All uploads are done via the CLI tool (Step 8b) or the raw API (Step 8c/8d).

---

### 8a — Enable sourcemaps in your project's build tool

Before uploading anything, your app must actually output `.map` files during its build.

**Vite** (`vite.config.ts` in the project being tested):
```ts
export default defineConfig({
  build: {
    sourcemap: true,
  },
})
```

**Webpack** (`webpack.config.js`):
```js
module.exports = {
  devtool: 'source-map',
}
```

**Next.js** (`next.config.js`):
```js
module.exports = {
  productionBrowserSourceMaps: true,
}
```

Run your build (`npm run build`) and confirm `.map` files appear in your output folder (e.g. `dist/`, `build/`, `.next/static/chunks/`).

---

### 8b — Upload via the CLI tool (recommended — works locally and in CI)

The CLI tool lives at [packages/sourcemap-upload/](packages/sourcemap-upload/) in this repo. It is **not yet published to npm**, so you install it directly from the local path.

**One-time install** (run from the root of the project being tested, not from this repo):

```bash
# Install the CLI as a dev dependency, pointing at the local package
# (replace <path-to-this-repo> with wherever you cloned JinnAi)
npm install -D "<path-to-this-repo>/packages/sourcemap-upload"
```

This adds `bi-upload-sourcemaps` as a local binary to the project being tested.

**Run it after your build:**

```bash
# Set your credentials (from the dashboard — Project page)
export BUG_INTELLIGENCE_PROJECT_ID="your-project-uuid"
export BUG_INTELLIGENCE_API_KEY="bi_live_your_key_here"
export BUG_INTELLIGENCE_API_URL="http://localhost:4000/api/v1"

# Then upload — pass the folder containing your .map files
npx bi-upload-sourcemaps dist
```

The CLI automatically:
1. Scans `dist/` (or whatever folder you pass) recursively for all `*.map` files
2. Creates a release record with an auto-detected version (from `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, or `git rev-parse HEAD`)
3. ZIPs all sourcemaps and uploads them in one batch request

**Or chain it directly into your build script** (`package.json` of the project being tested):

```json
{
  "scripts": {
    "build": "vite build && bi-upload-sourcemaps dist"
  }
}
```

**CLI flags reference:**

| Flag | Env Variable | Required | Default |
|---|---|---|---|
| `--project-id` | `BUG_INTELLIGENCE_PROJECT_ID` | ✅ | — |
| `--api-key` | `BUG_INTELLIGENCE_API_KEY` | ✅ | — |
| `--api-url` | `BUG_INTELLIGENCE_API_URL` | ❌ | `http://localhost:4000/api/v1` |
| `--version` | `BUG_INTELLIGENCE_VERSION` | ❌ | auto-detected from git/CI |
| `--no-batch` | — | ❌ | uploads individually instead of ZIP |
| `--dry-run` | — | ❌ | preview what would upload, no actual upload |
| `--quiet` | — | ❌ | suppress output except errors |

**Dry-run to preview before uploading:**

```bash
npx bi-upload-sourcemaps --dry-run dist
```

---

### 8c — Upload via raw API (manual / one-off)

If you prefer curl over the CLI:

```bash
PROJECT_ID="your-project-uuid"
API_KEY="bi_live_your_key_here"
VERSION="1.0.0"

# Step 1 — create a release record
RELEASE_ID=$(curl -s -X POST "http://localhost:4000/api/v1/projects/$PROJECT_ID/releases" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"version\": \"$VERSION\"}" | jq -r '.id')

# Step 2a — upload a single .map file
curl -X POST "http://localhost:4000/api/v1/projects/$PROJECT_ID/releases/$RELEASE_ID/sourcemaps" \
  -H "X-API-Key: $API_KEY" \
  -F "sourcemap=@dist/assets/index.js.map"

# Step 2b — OR upload a ZIP of all .map files at once (recommended)
zip -r sourcemaps.zip dist
curl -X POST "http://localhost:4000/api/v1/projects/$PROJECT_ID/releases/$RELEASE_ID/sourcemaps/batch" \
  -H "X-API-Key: $API_KEY" \
  -F "sourcemaps=@sourcemaps.zip"
```

Upload limits:
- Single file: max **50 MB**
- ZIP batch: max **100 MB** compressed, **250 MB** extracted, **200 files**

---

### 8d — Verify the upload

Open the **Releases** tab in the dashboard for your project. Each release is expandable and shows every uploaded sourcemap with:
- **Parsed** / **Failed** status
- File size
- Content hash (first 8 chars)

Or via API:

```bash
# Requires a dashboard JWT (Bearer token from login)
curl "http://localhost:4000/api/v1/projects/$PROJECT_ID/releases/$RELEASE_ID/sourcemaps" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 8e — CI/CD setup (automated uploads on every deploy)

Since the package is not yet on the public npm registry, you reference it from the local path in CI too by either:
- Committing the `packages/sourcemap-upload/` folder to the same repo as your app, or
- Publishing it to npm first (see note below)

**Option A — GitHub Actions (referencing local path in same monorepo):**

Add these secrets to your GitHub repo (Settings → Secrets → Actions):
```
BI_PROJECT_ID      → your project UUID from the dashboard
BI_API_KEY         → bi_live_... from the dashboard  
BI_API_URL         → http://your-server:4000/api/v1  (or your deployed backend URL)
```

Then add a step to your workflow after `npm run build`:

```yaml
# .github/workflows/deploy.yml
- name: Build
  run: npm ci && npm run build

- name: Upload sourcemaps to Bug Intelligence
  run: node path/to/packages/sourcemap-upload/bin/cli.js dist
  env:
    BUG_INTELLIGENCE_PROJECT_ID: ${{ secrets.BI_PROJECT_ID }}
    BUG_INTELLIGENCE_API_KEY: ${{ secrets.BI_API_KEY }}
    BUG_INTELLIGENCE_API_URL: ${{ secrets.BI_API_URL }}
    # GITHUB_SHA is automatically available — version is auto-detected
```

**Option B — Vercel (via build command override):**

In Vercel project settings → **Build & Output Settings** → **Build Command**:
```
npm run build && node ../../packages/sourcemap-upload/bin/cli.js dist
```

Add environment variables in Vercel project settings:
```
BUG_INTELLIGENCE_PROJECT_ID = your-project-uuid
BUG_INTELLIGENCE_API_KEY    = bi_live_...
BUG_INTELLIGENCE_API_URL    = https://your-backend.com/api/v1
```

`VERCEL_GIT_COMMIT_SHA` is injected automatically by Vercel — the CLI uses it as the release version.

**Option C — Netlify** (`netlify.toml` in the project being tested):

```toml
[build]
  command = "npm run build && node ../../packages/sourcemap-upload/bin/cli.js dist"

[build.environment]
  BUG_INTELLIGENCE_PROJECT_ID = "your-project-uuid"
  BUG_INTELLIGENCE_API_KEY    = "bi_live_..."
  BUG_INTELLIGENCE_API_URL    = "https://your-backend.com/api/v1"
```

`COMMIT_REF` is injected automatically by Netlify — the CLI uses it as the release version.

---

## Step 9 — Publish the CLI to npm & Use It Like a Real Package

Once published, any project can install with a single `npm install -D` without needing a local path or a copy of this repo. This is the production path.

---

### 9a — Prerequisites

- An npm account at https://www.npmjs.com (free)
- If you want to use the `@bug-intelligence/` scope, you need an npm **organisation** named `bug-intelligence` (also free). Create it at https://www.npmjs.com/org/create

Check you are logged in:

```bash
npm whoami
```

If not logged in:

```bash
npm login
# Enter your npm username, password, and email when prompted
# If you have 2FA enabled, enter the OTP too
```

---

### 9b — Bump the version before publishing

Every publish must have a unique version. Edit [packages/sourcemap-upload/package.json](packages/sourcemap-upload/package.json):

```json
{
  "version": "1.0.0"
}
```

Use semantic versioning:
- `1.0.0` → first public release
- `1.0.1` → patch (bug fix)
- `1.1.0` → minor (new flag/feature, backward-compatible)
- `2.0.0` → major (breaking change)

Or use the npm version command (auto-bumps and creates a git tag):

```bash
cd packages/sourcemap-upload
npm version patch    # 1.0.0 → 1.0.1
npm version minor    # 1.0.0 → 1.1.0
npm version major    # 1.0.0 → 2.0.0
```

---

### 9c — Publish to npm

```bash
cd packages/sourcemap-upload

# Scoped packages (@org/name) require --access public for free accounts
npm publish --access public
```

You should see output like:
```
npm notice Publishing to https://registry.npmjs.org/
npm notice name:    @bug-intelligence/sourcemap-upload
npm notice version: 1.0.0
+ @bug-intelligence/sourcemap-upload@1.0.0
```

Verify it is live:

```bash
npm info @bug-intelligence/sourcemap-upload
```

Or open: https://www.npmjs.com/package/@bug-intelligence/sourcemap-upload

---

### 9d — Install the published package in a project being tested

Once published, anyone can install it without needing this repo at all:

```bash
# In the root of the project being tested
npm install -D @bug-intelligence/sourcemap-upload
```

This is the only install command they ever need. It downloads from the public npm registry.

Verify the CLI binary is available:

```bash
npx bi-upload-sourcemaps --help
```

---

### 9e — Set credentials in the project being tested

Get these two values from the dashboard (Project page):

```bash
# Set for the current terminal session
export BUG_INTELLIGENCE_PROJECT_ID="your-project-uuid"
export BUG_INTELLIGENCE_API_KEY="bi_live_your_key_here"
export BUG_INTELLIGENCE_API_URL="http://localhost:4000/api/v1"   # or your deployed backend URL
```

Or add them to a `.env` file if your project uses `dotenv` in its scripts (never commit `.env` to git).

---

### 9f — Add to the project's build script

Open the `package.json` of the project being tested and add `bi-upload-sourcemaps` after the build command:

```json
{
  "scripts": {
    "build": "vite build && bi-upload-sourcemaps dist"
  }
}
```

Change `dist` to wherever your build tool outputs files (`build/`, `out/`, `.next/`, etc.).

From now on every `npm run build` automatically creates a release and uploads all sourcemaps. No extra step needed.

**Test it with a dry run first:**

```bash
npm run build -- --dry-run
# or directly:
npx bi-upload-sourcemaps --dry-run dist
```

Dry-run output looks like:
```
📦 @bug-intelligence/sourcemap-upload v1.0.0
📁 Found 3 sourcemap(s) in dist
🔖 Release version: a3f91bc2...

[DRY-RUN] Would create release "a3f91bc2..." at http://localhost:4000/api/v1/projects/.../releases
[DRY-RUN] Would upload ZIP with 3 sourcemaps (142.3 KB)
🎉 Done.
```

---

### 9g — CI/CD setup using the published package

Now that the package is on npm, CI/CD is clean — no local path references needed.

**GitHub Actions:**

Add these three secrets to your GitHub repo (Settings → Secrets and variables → Actions → New repository secret):

| Secret name | Value |
|---|---|
| `BI_PROJECT_ID` | your project UUID from the dashboard |
| `BI_API_KEY` | `bi_live_...` from the dashboard |
| `BI_API_URL` | your deployed backend URL, e.g. `https://api.yourcompany.com/api/v1` |

Then in your workflow file (e.g. `.github/workflows/deploy.yml`):

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload sourcemaps to Bug Intelligence
        run: npx @bug-intelligence/sourcemap-upload dist
        env:
          BUG_INTELLIGENCE_PROJECT_ID: ${{ secrets.BI_PROJECT_ID }}
          BUG_INTELLIGENCE_API_KEY: ${{ secrets.BI_API_KEY }}
          BUG_INTELLIGENCE_API_URL: ${{ secrets.BI_API_URL }}
          # GITHUB_SHA is auto-injected by GitHub Actions — used as release version
```

**Vercel:**

1. Go to your Vercel project → **Settings** → **Environment Variables** and add:

| Name | Value |
|---|---|
| `BUG_INTELLIGENCE_PROJECT_ID` | your project UUID |
| `BUG_INTELLIGENCE_API_KEY` | `bi_live_...` |
| `BUG_INTELLIGENCE_API_URL` | `https://your-backend.com/api/v1` |

2. Go to **Settings** → **Build & Output Settings** → **Build Command**, override to:

```
npm run build && npx @bug-intelligence/sourcemap-upload dist
```

`VERCEL_GIT_COMMIT_SHA` is injected automatically — the CLI uses it as the release version. No extra config needed.

**Netlify:**

Add to `netlify.toml` in the root of the project being tested:

```toml
[build]
  command = "npm run build && npx @bug-intelligence/sourcemap-upload dist"

[build.environment]
  BUG_INTELLIGENCE_PROJECT_ID = "your-project-uuid"
  BUG_INTELLIGENCE_API_KEY    = "bi_live_..."
  BUG_INTELLIGENCE_API_URL    = "https://your-backend.com/api/v1"
```

`COMMIT_REF` is injected automatically by Netlify — the CLI uses it as the release version.

**Cloudflare Pages:**

1. Go to your Pages project → **Settings** → **Environment variables** and add the three `BUG_INTELLIGENCE_*` variables.
2. Override the build command in the dashboard or `wrangler.toml`:

```toml
# wrangler.toml
[env.production]
build_command = "npm run build && npx @bug-intelligence/sourcemap-upload dist"
```

`CF_PAGES_COMMIT_SHA` is injected automatically — the CLI picks it up as the release version.

---

### 9h — Publishing updates

When you fix bugs or add flags to the CLI, re-publish:

```bash
cd packages/sourcemap-upload

# Bump version
npm version patch

# Publish
npm publish --access public
```

Projects using `@bug-intelligence/sourcemap-upload` in their `package.json` with a range like `"^1.0.0"` will pick up the new version on their next `npm install` or `npm ci`. Pinned versions (`"1.0.0"`) won't update automatically — they need to run `npm update @bug-intelligence/sourcemap-upload`.

---

## Daily Workflow (after everything is set up)

Open **3 terminals**:

```bash
# Terminal 1 — infrastructure (skip if already running)
docker compose up -d

# Terminal 2 — backend
cd backend && npm run start:dev

# Terminal 3 — dashboard
cd dashboard && npm run dev
```

The Chrome extension runs from the already-built `extension/dist/` and does not need to be restarted.

---

## All Service URLs

| Service       | URL                          | Credentials         |
|---------------|------------------------------|---------------------|
| Dashboard     | http://localhost:5173        | your registered account |
| Backend API   | http://localhost:4000        |                     |
| Swagger Docs  | http://localhost:4000/api    | interactive API explorer |
| Prometheus    | http://localhost:9090        | no login            |
| Grafana       | http://localhost:3001        | `admin` / `admin`   |

---

## Release API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/projects/:id/releases` | API key or JWT | Create a release |
| `GET`  | `/projects/:id/releases` | JWT | List releases (paginated) |
| `POST` | `/projects/:id/releases/:rid/sourcemaps` | API key or JWT | Upload single `.map` file |
| `POST` | `/projects/:id/releases/:rid/sourcemaps/batch` | API key or JWT | Upload ZIP of `.map` files |
| `GET`  | `/projects/:id/releases/:rid/sourcemaps` | JWT | List sourcemaps for a release |

---

## Troubleshooting

**Backend fails to start — "Can't reach database"**
→ Run `docker compose up -d` and wait ~5 seconds before starting the backend.

**Sourcemap upload returns 400 "Sourcemap validation returned false"**
→ The `.map` file must be a valid JSON source map. Make sure your bundler (Vite/Webpack) is configured to output source maps (`sourcemap: true` in `vite.config.ts`).

**Stack traces still minified in Bug detail**
→ Check the Releases tab — if the sourcemap status shows "Failed", re-upload. Also confirm the `version` you passed to `create release` matches the `release` field your extension sends (set via the extension popup or the `VITE_RELEASE` env var).

**Prometheus target is DOWN**
→ Visit http://localhost:4000/api/v1/metrics — if it errors, the backend metrics endpoint is not running. Restart the backend.

**Extension not capturing — popup shows "Inactive"**
→ Make sure you clicked **Start Capture** in the popup and that the API key is correctly pasted (format: `bi_live_` followed by 64 hex characters).

---

## Quick Reference — upload sourcemaps from any app you're testing

```bash
# In the root of the app being tested, after enabling sourcemaps in its build config:
export BUG_INTELLIGENCE_PROJECT_ID="<your-project-uuid>"
export BUG_INTELLIGENCE_API_KEY="<bi_live_...>"
export BUG_INTELLIGENCE_API_URL="http://localhost:4000/api/v1"

npm run build
npx bi-upload-sourcemaps dist   # or build/, out/, .next/ — wherever .map files land
```

## --------------------------------#####-------------------------------------------
