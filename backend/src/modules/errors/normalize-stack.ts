// Strip memory addresses, line numbers, and file hashes so equivalent errors get the same fingerprint
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
