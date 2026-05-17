import { defineConfig, Plugin, build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

function getGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

function fixPopupPath(): Plugin {
  return {
    name: 'fix-popup-path',
    closeBundle() {
      const src = resolve(__dirname, 'dist/src/popup/index.html');
      const dest = resolve(__dirname, 'dist/popup/index.html');
      if (fs.existsSync(src)) {
        fs.mkdirSync(resolve(__dirname, 'dist/popup'), { recursive: true });
        fs.copyFileSync(src, dest);
        fs.rmSync(resolve(__dirname, 'dist/src'), { recursive: true, force: true });
      }
    },
  };
}

const contentScripts = [
  'error-tracker',
  'network-tracker',
  'console-tracker',
  'dom-tracker',
  'bridge',
];

// Content scripts cannot use ES module imports — build as IIFE with all deps inlined
function buildContentScripts(releaseSha: string): Plugin {
  return {
    name: 'build-content-scripts',
    async closeBundle() {
      for (const name of contentScripts) {
        await build({
          configFile: false,
          define: {
            'window.__BI_RELEASE__': JSON.stringify(releaseSha),
            '__BI_RELEASE__': JSON.stringify(releaseSha),
          },
          build: {
            sourcemap: true,
            outDir: resolve(__dirname, 'dist/content'),
            emptyOutDir: false,
            lib: {
              entry: resolve(__dirname, `src/content/${name}.ts`),
              name: name.replace(/-./g, (m) => m[1].toUpperCase()),
              formats: ['iife'],
              fileName: () => `${name}.js`,
            },
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        });
      }
    },
  };
}

const RELEASE_SHA = getGitSha();

export default defineConfig({
  plugins: [react(), fixPopupPath(), buildContentScripts(RELEASE_SHA)],
  define: {
    'window.__BI_RELEASE__': JSON.stringify(RELEASE_SHA),
    '__BI_RELEASE__': JSON.stringify(RELEASE_SHA),
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'popup/index': resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
