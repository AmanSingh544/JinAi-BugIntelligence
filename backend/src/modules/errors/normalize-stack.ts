// Normalize a stack trace for display / human readability
export function normalizeStack(stack: string | undefined): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .map((line) =>
      line
        .replace(/:\d+:\d+/g, '')        // strip :line:col
        .replace(/0x[0-9a-f]+/gi, '0x0') // strip memory addresses
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * Normalize a stack trace specifically for fingerprinting.
 * This is stricter than display normalization because it aims to produce
 * the SAME fingerprint for the SAME logical bug across different builds/releases.
 *
 * Rules:
 * 1. Strip all line/column numbers
 * 2. Strip memory addresses
 * 3. Strip webpack chunk hashes:  ".js?1234" → ".js"
 * 4. Strip webpack chunk IDs in brackets: "[123]" → "[chunk]"
 * 5. Normalize async wrappers: "async Promise.all" → "Promise.all"
 * 6. Normalize vendor paths: "node_modules/xxx/lib/index.js" → "node_modules/xxx"
 * 7. Collapse whitespace
 */
export function fingerprintNormalizeStack(stack: string | undefined): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .map((line) => {
      let normalized = line
        .replace(/:\d+:\d+/g, '')               // strip :line:col
        .replace(/0x[0-9a-f]+/gi, '0x0')        // strip memory addresses
        .replace(/\.js\?[a-zA-Z0-9]+/g, '.js')  // strip webpack query hashes
        .replace(/\[(\d+)\]/g, '[chunk]')       // strip webpack chunk IDs
        .replace(/^\s*async\s+/i, '')           // strip leading "async "
        .replace(/node_modules\/([^/]+)(?:\/.*)?/g, 'node_modules/$1') // normalize vendor paths
        .replace(/\s+/g, ' ')
        .trim();

      // Normalize anonymous/async wrapper frames
      if (/^at\s+.*\(/.test(normalized)) {
        const match = normalized.match(/^at\s+(.+?)\s*\(/);
        if (match) {
          let fnName = match[1].trim();
          // Collapse common async wrappers
          fnName = fnName
            .replace(/^async\s+/i, '')
            .replace(/^_+/, '')          // strip leading underscores from mangled names
            .replace(/\.[a-zA-Z0-9$_]+\$\d+$/, ''); // strip trailing mangled suffixes like .func$1
          normalized = normalized.replace(/^at\s+.+?\s*\(/, `at ${fnName} (`);
        }
      }

      return normalized;
    })
    .filter(Boolean)
    .join('\n');
}
