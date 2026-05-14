#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseArgs } = require('util');
const AdmZip = require('adm-zip');

const PKG = require('../package.json');

/* ── CLI args ─────────────────────────────────────────────── */

const { values, positionals } = parseArgs({
  options: {
    'project-id': { type: 'string' },
    'api-key':    { type: 'string' },
    'api-url':    { type: 'string' },
    'version':    { type: 'string' },
    'batch':      { type: 'boolean', default: true },
    'dry-run':    { type: 'boolean', default: false },
    'help':       { type: 'boolean', default: false },
    'quiet':      { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
${PKG.name} v${PKG.version}

Upload build sourcemaps to Bug Intelligence Platform.

Usage:
  bi-upload-sourcemaps [options] <build-output-dir>

Arguments:
  <build-output-dir>   Directory containing *.map files (default: "dist")

Options:
  --project-id <id>    Project UUID (env: BUG_INTELLIGENCE_PROJECT_ID)
  --api-key <key>      Project API key (env: BUG_INTELLIGENCE_API_KEY)
  --api-url <url>      API base URL (env: BUG_INTELLIGENCE_API_URL)
  --version <ver>      Release version override (env: BUG_INTELLIGENCE_VERSION)
  --batch              Use ZIP batch upload (default)
  --no-batch           Upload files individually
  --dry-run            Log actions without uploading
  --quiet              Suppress all output except errors
  --help               Show this help message

Version auto-detection (in priority order):
  1. --version flag or BUG_INTELLIGENCE_VERSION env var
  2. VERCEL_GIT_COMMIT_SHA
  3. GITHUB_SHA
  4. CF_PAGES_COMMIT_SHA
  5. COMMIT_REF (Netlify)
  6. git rev-parse HEAD
  7. build-<timestamp> fallback

Examples:
  # Basic usage with env vars
  BUG_INTELLIGENCE_PROJECT_ID=xxx BUG_INTELLIGENCE_API_KEY=yyy bi-upload-sourcemaps dist

  # Explicit flags
  bi-upload-sourcemaps --project-id xxx --api-key yyy --version abc123 ./build

  # Dry run to preview
  bi-upload-sourcemaps --dry-run dist
`);
  process.exit(0);
}

/* ── Config resolution ────────────────────────────────────── */

const API_URL     = (values['api-url']     || process.env.BUG_INTELLIGENCE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const PROJECT_ID  = values['project-id']  || process.env.BUG_INTELLIGENCE_PROJECT_ID;
const API_KEY     = values['api-key']     || process.env.BUG_INTELLIGENCE_API_KEY;
const DRY_RUN     = values['dry-run'];
const QUIET       = values['quiet'];
const BATCH       = values['batch'];
const VERSION     = values['version']     || process.env.BUG_INTELLIGENCE_VERSION || detectVersion();

function log(...args) {
  if (!QUIET) console.log(...args);
}

function detectVersion() {
  const envVars = [
    'VERCEL_GIT_COMMIT_SHA',
    'GITHUB_SHA',
    'CF_PAGES_COMMIT_SHA',
    'COMMIT_REF',
  ];
  for (const key of envVars) {
    if (process.env[key]) return process.env[key];
  }
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

function detectCiProvider() {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.GITHUB_ACTIONS) return 'github-actions';
  if (process.env.NETLIFY) return 'netlify';
  if (process.env.CF_PAGES) return 'cloudflare-pages';
  return 'unknown';
}

function normalizeFilename(raw) {
  try {
    raw = new URL(raw).pathname;
  } catch {}
  return raw.replace(/^(webpack:\/\/\/|vite:\/\/\/)/, '').replace(/[?#].*$/, '').split('/').pop() || raw;
}

function parseSourcemapFile(buffer) {
  try {
    const str = buffer.toString('utf-8', 0, Math.min(buffer.length, 10 * 1024 * 1024));
    return JSON.parse(str).file || null;
  } catch {
    return null;
  }
}

/* ── Validation ───────────────────────────────────────────── */

const missing = [];
if (!PROJECT_ID) missing.push('--project-id / BUG_INTELLIGENCE_PROJECT_ID');
if (!API_KEY)    missing.push('--api-key / BUG_INTELLIGENCE_API_KEY');

if (missing.length) {
  console.error(`❌ Missing required option(s):\n   ${missing.join('\n   ')}\n`);
  console.error('Run with --help for usage information.');
  process.exit(1);
}

/* ── File discovery ───────────────────────────────────────── */

const buildDir = path.resolve(positionals[0] || 'dist');

function findMapFiles(dir) {
  const maps = [];
  if (!fs.existsSync(dir)) return maps;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      maps.push(...findMapFiles(full));
    } else if (entry.name.endsWith('.map')) {
      maps.push(full);
    }
  }
  return maps;
}

const mapFiles = findMapFiles(buildDir);

if (mapFiles.length === 0) {
  console.error(`⚠️  No .map files found in ${buildDir}`);
  console.error('   Make sure sourcemaps are enabled in your build tool:');
  console.error('   Vite:    build: { sourcemap: true }');
  console.error('   Webpack: devtool: "source-map"');
  process.exit(0);
}

log(`📦 ${PKG.name} v${PKG.version}`);
log(`📁 Found ${mapFiles.length} sourcemap(s) in ${buildDir}`);
log(`🔖 Release version: ${VERSION}\n`);

// Parse and validate each sourcemap
const sourcemaps = [];
for (const mapFile of mapFiles) {
  const filename = path.basename(mapFile);
  const buffer = fs.readFileSync(mapFile);
  const declaredFile = parseSourcemapFile(buffer);
  const normalizedDeclared = declaredFile ? normalizeFilename(declaredFile) : null;
  const normalizedEntry = normalizeFilename(filename.replace(/\.map$/i, ''));

  if (declaredFile && normalizedDeclared !== normalizedEntry) {
    log(`⚠️  ${filename}: declared file "${declaredFile}" (normalized: ${normalizedDeclared}) does not match entry name (${normalizedEntry})`);
  } else if (declaredFile) {
    log(`✓  ${filename} → declared file: ${declaredFile}`);
  } else {
    log(`⚠️  ${filename}: no "file" field found in sourcemap JSON`);
  }

  sourcemaps.push({ path: mapFile, filename, buffer, declaredFile });
}
log('');

/* ── API calls ────────────────────────────────────────────── */

async function createRelease() {
  const url = `${API_URL}/projects/${PROJECT_ID}/releases`;
  const metadata = JSON.stringify({
    buildTool: 'vite',
    version: VERSION,
    uploadedAt: new Date().toISOString(),
    ciProvider: detectCiProvider(),
  });

  if (DRY_RUN) {
    log(`[DRY-RUN] Would create release "${VERSION}" at ${url}`);
    return { id: 'dry-run-release-id', version: VERSION };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({ version: VERSION, metadata }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Create release failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function uploadBatch(releaseId) {
  const url = `${API_URL}/projects/${PROJECT_ID}/releases/${releaseId}/sourcemaps/batch`;

  const zip = new AdmZip();
  for (const sm of sourcemaps) {
    zip.addLocalFile(sm.path, '', sm.filename);
  }
  const zipBuffer = zip.toBuffer();

  if (DRY_RUN) {
    log(`[DRY-RUN] Would upload ZIP with ${sourcemaps.length} sourcemaps (${(zipBuffer.length / 1024).toFixed(1)} KB) to ${url}`);
    return { uploaded: sourcemaps.length, items: sourcemaps.map(s => ({ filename: s.filename })) };
  }

  const formData = new FormData();
  const blob = new Blob([zipBuffer], { type: 'application/zip' });
  formData.append('sourcemaps', blob, 'sourcemaps.zip');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Batch upload failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function uploadIndividual(releaseId) {
  const results = [];
  let ok = 0;
  let fail = 0;

  for (const sm of sourcemaps) {
    const url = `${API_URL}/projects/${PROJECT_ID}/releases/${releaseId}/sourcemaps`;

    if (DRY_RUN) {
      log(`[DRY-RUN] Would upload ${sm.filename} to ${url}`);
      results.push({ filename: sm.filename });
      ok++;
      continue;
    }

    const formData = new FormData();
    formData.append('version', VERSION);
    formData.append('metadata', JSON.stringify({ buildTool: 'vite', version: VERSION }));
    const blob = new Blob([sm.buffer], { type: 'application/octet-stream' });
    formData.append('sourcemap', blob, sm.filename);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-Key': API_KEY,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const result = await res.json();
      log(`✅ ${sm.filename}  →  ${result.minified_filename || result.id}`);
      ok++;
    } catch (err) {
      console.error(`❌ ${sm.filename}  →  ${err.message}`);
      fail++;
    }
  }

  return { uploaded: ok, failed: fail, items: results };
}

/* ── Main ─────────────────────────────────────────────────── */

async function main() {
  // 1. Create release
  const release = await createRelease();
  log(`🚀 Created release ${release.id} (version: ${release.version})\n`);

  // 2. Upload sourcemaps
  let result;
  if (BATCH) {
    result = await uploadBatch(release.id);
  } else {
    result = await uploadIndividual(release.id);
  }

  if (BATCH) {
    log(`\n📤 Uploaded ${result.uploaded} sourcemap(s) via batch ZIP`);
  } else {
    log(`\n📤 Uploaded ${result.uploaded} sourcemap(s), ${result.failed || 0} failed`);
  }

  log(`🎉 Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
