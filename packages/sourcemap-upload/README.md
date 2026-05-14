# @bug-intelligence/sourcemap-upload

Upload build sourcemaps to Bug Intelligence Platform. Works with Vite, Webpack, Next.js, Rollup, or any build tool that generates `.map` files.

## Install

```bash
npm install -D @bug-intelligence/sourcemap-upload
```

## Quick Start

### 1. Enable sourcemaps in your build tool

**Vite:**
```ts
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: true,
  },
})
```

**Webpack:**
```js
// webpack.config.js
module.exports = {
  devtool: 'source-map',
}
```

**Next.js:**
```js
// next.config.js
module.exports = {
  productionBrowserSourceMaps: true,
}
```

### 2. Set environment variables

Get your API key from the Bug Intelligence Dashboard → Project Settings.

```bash
BUG_INTELLIGENCE_PROJECT_ID=your-project-uuid
BUG_INTELLIGENCE_API_KEY=bi_live_xxxxxxxx...
BUG_INTELLIGENCE_API_URL=https://your-api.com/api/v1   # optional, defaults to localhost
```

### 3. Add to your build script

**package.json:**
```json
{
  "scripts": {
    "build": "vite build && bi-upload-sourcemaps dist"
  }
}
```

That's it. Every deploy will now automatically upload sourcemaps.

---

## Usage

### CLI

```bash
# Using env vars
bi-upload-sourcemaps dist

# Using flags
bi-upload-sourcemaps --project-id xxx --api-key yyy --version abc123 ./build

# Dry run (see what would upload without actually uploading)
bi-upload-sourcemaps --dry-run dist

# Show help
bi-upload-sourcemaps --help
```

### Options

| Flag | Env Variable | Required | Default |
|---|---|---|---|
| `--project-id` | `BUG_INTELLIGENCE_PROJECT_ID` | ✅ | — |
| `--api-key` | `BUG_INTELLIGENCE_API_KEY` | ✅ | — |
| `--api-url` | `BUG_INTELLIGENCE_API_URL` | ❌ | `http://localhost:4000/api/v1` |
| `--version` | `BUG_INTELLIGENCE_VERSION` | ❌ | auto-detected from git/CI |
| `--dry-run` | `BUG_INTELLIGENCE_DRY_RUN` | ❌ | `false` |
| `--quiet` | — | ❌ | `false` |

### Version Auto-Detection

If you don't pass `--version`, the CLI detects it automatically:

1. `VERCEL_GIT_COMMIT_SHA` (Vercel)
2. `GITHUB_SHA` (GitHub Actions)
3. `CF_PAGES_COMMIT_SHA` (Cloudflare Pages)
4. `COMMIT_REF` (Netlify)
5. `git rev-parse HEAD` (local builds)
6. `build-<timestamp>` (fallback)

---

## CI/CD Examples

### Vercel

Add to **Project Settings → Environment Variables:**
```
BUG_INTELLIGENCE_PROJECT_ID=xxx
BUG_INTELLIGENCE_API_KEY=bi_live_xxx
BUG_INTELLIGENCE_API_URL=https://your-api.com/api/v1
```

Add to **package.json:**
```json
"build": "vite build && bi-upload-sourcemaps dist"
```

### GitHub Actions

```yaml
- name: Build and upload sourcemaps
  run: |
    npm ci
    npm run build
    npx bi-upload-sourcemaps dist
  env:
    BUG_INTELLIGENCE_PROJECT_ID: ${{ secrets.BI_PROJECT_ID }}
    BUG_INTELLIGENCE_API_KEY: ${{ secrets.BI_API_KEY }}
    BUG_INTELLIGENCE_API_URL: https://your-api.com/api/v1
    GITHUB_SHA: ${{ github.sha }}
```

### Netlify

```toml
# netlify.toml
[build]
  command = "npm run build && npx bi-upload-sourcemaps dist"

[build.environment]
  BUG_INTELLIGENCE_PROJECT_ID = "xxx"
  BUG_INTELLIGENCE_API_KEY = "bi_live_xxx"
```

---

## How It Works

1. After your build completes, the CLI finds all `*.map` files in your build output directory
2. For each sourcemap, it creates a release on Bug Intelligence Platform:
   - **Version:** `{git-commit-sha}__{filename}`
   - **File:** the `.map` file itself
   - **Metadata:** build tool, CI provider, timestamp
3. When your app throws an error in production, the Bug Intelligence backend uses these sourcemaps to unminify stack traces

---

## Requirements

- Node.js >= 18

## License

MIT


## ---------------------------------------------------------

Works perfectly. Here's what was built and how to use it:

---

## What was created

```
packages/sourcemap-upload/
├── package.json          # npm package config
├── bin/
│   └── cli.js            # The CLI tool
└── README.md             # Customer-facing docs
```

**Package name:** `@bug-intelligence/sourcemap-upload`  
**CLI command:** `bi-upload-sourcemaps`

---

## Tested it locally

```bash
# Help works
node bin/cli.js --help

# Dry-run finds sourcemaps correctly
node bin/cli.js --dry-run --project-id test --api-key test ../../dashboard/dist
```

Output:
```
📦 @bug-intelligence/sourcemap-upload v1.0.0
📁 Found 1 sourcemap(s) in .../dashboard/dist
🔖 Version prefix: d90e16bb9d07f810a18038442cb18f9563c21d58

[DRY-RUN] index-DbcfDImj.js.map → version: d90e16bb9d07f810a18038442cb18f9563c21d58__index-DbcfDImj.js.map
```

---

## How to publish it

```bash
cd packages/sourcemap-upload

# 1. Create npm account + org if you haven't already
npm login

# 2. Publish
npm publish --access public
```

Then customers can install it:

```bash
npm install -D @bug-intelligence/sourcemap-upload
```

---

## How customers use it

**In their `package.json`:**
```json
{
  "scripts": {
    "build": "vite build && bi-upload-sourcemaps dist"
  }
}
```

**In their CI env vars (Vercel/GitHub/Netlify):**
```
BUG_INTELLIGENCE_PROJECT_ID=d161610a-36a0-4095-b631-f294ccb931d7
BUG_INTELLIGENCE_API_KEY=bi_live_xxxxxxxx...
BUG_INTELLIGENCE_API_URL=https://your-api.com/api/v1
```

That's it. One install, one line in `package.json`, two env vars.

---

## Full flow now

```
Customer's app (Netflix.com, Acme Corp, etc.)
│
├─► npm install -D @bug-intelligence/sourcemap-upload
│
├─► Customer adds to package.json:
│     "build": "vite build && bi-upload-sourcemaps dist"
│
├─► Customer sets env vars in Vercel:
│     BUG_INTELLIGENCE_PROJECT_ID=xxx
│     BUG_INTELLIGENCE_API_KEY=bi_live_xxx
│
├─► Customer deploys:
│     vite build  →  generates *.js.map files
│     bi-upload-sourcemaps  →  POST /releases with X-API-Key
│
└─► Later when their user hits an error:
      Bug Intelligence extension captures minified stack
      Backend looks up customer's sourcemap by version
      Backend unminifies → shows original file:line in Dashboard
```

The backend already supports `X-API-Key` auth on `POST /releases` (from the guard I added earlier). The CLI uses that. Everything is wired.