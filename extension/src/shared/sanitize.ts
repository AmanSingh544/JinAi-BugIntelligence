import type { JsonValue } from './types';

const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // emails
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, // credit cards
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\bBearer\s+[a-zA-Z0-9_\-.]+/gi, // bearer tokens
  /\bBasic\s+[a-zA-Z0-9=+/]+/gi, // basic auth
  /["']?authorization["']?\s*[:=]\s*["'][^"']{10,}["']/gi, // auth headers
  /["']?cookie["']?\s*[:=]\s*["'][^"']{10,}["']/gi, // cookies
  /["']?password["']?\s*[:=]\s*["'][^"']+["']/gi, // passwords
  /["']?token["']?\s*[:=]\s*["'][^"']{10,}["']/gi, // tokens
  /["']?secret["']?\s*[:=]\s*["'][^"']{10,}["']/gi, // secrets
];

export function sanitizeString(value: string): string {
  let result = value;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function sanitizePayload(data: JsonValue): JsonValue {
  if (data === null || typeof data === 'boolean' || typeof data === 'number') return data;
  if (typeof data === 'string') return sanitizeString(data);

  if (Array.isArray(data)) {
    return data.map(sanitizePayload);
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = sanitizePayload(value);
  }
  return result;
}
