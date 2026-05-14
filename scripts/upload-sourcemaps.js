#!/usr/bin/env node
/**
 * Upload Vite build sourcemaps to Bug Intelligence Platform.
 *
 * Runs after `vite build` in CI/CD (Vercel, GitHub Actions, Netlify, etc.).
 *
 * Usage:
 *   node upload-sourcemaps.js [build-output-dir]
 *
 * Required env vars:
 *   BUG_INTELLIGENCE_PROJECT_ID  Project UUID
 *   BUG_INTELLIGENCE_API_KEY     Project API key (from project settings)
 *
 * Optional env vars:
 *   BUG_INTELLIGENCE_API_URL     API base URL (default: http://localhost:4000/api/v1)
 *   BUG_INTELLIGENCE_VERSION     Release version override
 *   BUG_INTELLIGENCE_DRY_RUN     Set to "1" to log without uploading
 *
 * Version auto-detection priority:
 *   1. BUG_INTELLIGENCE_VERSION env var
 *   2. VERCEL_GIT_COMMIT_SHA
 *   3. GITHUB_SHA
 *   4. CF_PAGES_COMMIT_SHA
 *   5. COMMIT_REF (Netlify)
 *   6. git rev-parse HEAD
 *   7. build-<timestamp> fallback
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_URL = (process.env.BUG_INTELLIGENCE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const PROJECT_ID = process.env.BUG_INTELLIGENCE_PROJECT_ID;
const API_KEY = process.env.BUG_INTELLIGENCE_API_KEY;
const DRY_RUN = process.env.BUG_INTELLIGENCE_DRY_RUN === '1';
const VERSION = process.env.BUG_INTELLIGENCE_VERSION || detectVersion();

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

async function uploadSourcemap(mapFile) {
  const filename = path.basename(mapFile);
  // Each .map becomes its own release because the API currently stores one
  // sourcemap per release. The version is prefixed with the commit SHA so
  // the unminifier can look it up.
  const version = `${VERSION}__${filename}`;

  const metadata = JSON.stringify({
    buildTool: 'vite',
    filename,
    version: VERSION,
    uploadedAt: new Date().toISOString(),
    ciProvider: detectCiProvider(),
  });

  const formData = new FormData();
  formData.append('version', version);
  formData.append('metadata', metadata);

  const buffer = fs.readFileSync(mapFile);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  formData.append('sourcemap', blob, filename);

  const url = `${API_URL}/projects/${PROJECT_ID}/releases`;

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would upload ${filename} → ${url} (version: ${version})`);
    return { id: 'dry-run', version };
  }

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

  return res.json();
}

async function main() {
  const errors = [];

  if (!PROJECT_ID) {
    console.error('❌ Missing env var: BUG_INTELLIGENCE_PROJECT_ID');
    errors.push('BUG_INTELLIGENCE_PROJECT_ID');
  }
  if (!API_KEY) {
    console.error('❌ Missing env var: BUG_INTELLIGENCE_API_KEY');
    errors.push('BUG_INTELLIGENCE_API_KEY');
  }
  if (errors.length) {
    console.error('\nSet these in your CI environment or .env file.\n');
    process.exit(1);
  }

  const buildDir = process.argv[2] || 'dist';
  const mapFiles = findMapFiles(path.resolve(buildDir));

  if (mapFiles.length === 0) {
    console.log(`⚠️  No .map files found in ${buildDir}`);
    console.log('   Make sure sourcemaps are enabled in your Vite config (build.sourcemap: true)');
    process.exit(0);
  }

  console.log(`📦 Found ${mapFiles.length} sourcemap(s) in ${buildDir}`);
  console.log(`🔖 Release version prefix: ${VERSION}\n`);

  for (const mapFile of mapFiles) {
    const filename = path.basename(mapFile);
    try {
      const result = await uploadSourcemap(mapFile);
      console.log(`✅ ${filename}  →  release ${result.version || result.id}`);
    } catch (err) {
      console.error(`❌ ${filename}  →  ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('\n🎉 Sourcemap upload complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
