import { readFile } from 'fs/promises';
import { SourceMapConsumer } from 'source-map';

interface UnminifiedPosition {
  source: string;
  line: number;
  column: number;
  name?: string;
}

interface StackFrame {
  raw: string;
  functionName: string;
  file: string;
  line: number;
  column: number;
}

// Simple in-memory LRU cache for parsed SourceMapConsumers.
const sourcemapCache = new Map<
  string,
  { consumer: SourceMapConsumer; lastUsed: number }
>();
const MAX_CACHE_SIZE = 20;

async function getCachedConsumer(sourcemapPath: string): Promise<SourceMapConsumer | null> {
  const cached = sourcemapCache.get(sourcemapPath);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.consumer;
  }

  try {
    const raw = await readFile(sourcemapPath, 'utf-8');
    const consumer = await new SourceMapConsumer(raw);

    // Evict oldest if cache is full
    if (sourcemapCache.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of sourcemapCache.entries()) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        sourcemapCache.get(oldestKey)?.consumer.destroy();
        sourcemapCache.delete(oldestKey);
      }
    }

    sourcemapCache.set(sourcemapPath, { consumer, lastUsed: Date.now() });
    return consumer;
  } catch {
    return null;
  }
}

export function normalizeMinifiedFilename(raw: string): string {
  try {
    raw = new URL(raw).pathname;
  } catch {
    // not a URL, keep as-is
  }
  return (
    raw
      .replace(/^(webpack:\/\/\/|vite:\/\/\/)/, '')
      .replace(/[?#].*$/, '')
      .split('/')
      .pop() || raw
  );
}

function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const lines = stack.split('\n');

  for (const line of lines) {
    // Match patterns like:
    // at functionName (file.js:1:2)
    // at file.js:1:2
    // at functionName (https://cdn.com/file.js:1:2)
    const match = line.match(/at\s+(.+?)\s*\(?(.*?):(\d+):(\d+)\)?/);
    if (match) {
      const [, fnName, file, lineNum, colNum] = match;
      frames.push({
        raw: line,
        functionName: fnName?.trim() || '<anonymous>',
        file: file || '',
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
      });
    }
  }

  return frames;
}

export async function validateSourcemap(sourcemapPath: string): Promise<boolean> {
  const consumer = await getCachedConsumer(sourcemapPath);
  return consumer !== null;
}

export interface SourcemapRecord {
  sourcemap_path: string;
  declared_file: string | null;
  sourcemap_parsed: boolean;
}

export async function unminifyStack(
  minifiedStack: string,
  sourcemaps: Map<string, SourcemapRecord>,
): Promise<string | null> {
  const frames = parseStackFrames(minifiedStack);
  if (frames.length === 0) return null;

  const result: string[] = [];
  let mappedAny = false;

  for (const frame of frames) {
    const normalizedFile = normalizeMinifiedFilename(frame.file);
    const record = sourcemaps.get(normalizedFile);

    if (!record || !record.sourcemap_parsed) {
      // No sourcemap for this frame — preserve original
      result.push(frame.raw);
      continue;
    }

    const consumer = await getCachedConsumer(record.sourcemap_path);
    if (!consumer) {
      // Failed to load consumer — preserve original
      result.push(frame.raw);
      continue;
    }

    const pos = consumer.originalPositionFor({
      line: frame.line,
      column: frame.column,
    });

    if (pos.source) {
      mappedAny = true;
      result.push(
        `at ${pos.name || frame.functionName} (${pos.source}:${pos.line}:${pos.column})`,
      );
    } else {
      // Mapping returned no source — preserve original
      result.push(frame.raw);
    }
  }

  return mappedAny ? result.join('\n') : null;
}
