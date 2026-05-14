import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\bBearer\s+[a-zA-Z0-9_\-.]+/gi,
  /\bBasic\s+[a-zA-Z0-9=+/]+/gi,
  /["']?authorization["']?\s*[:=]\s*["'][^"']{10,}["']/gi,
  /["']?cookie["']?\s*[:=]\s*["'][^"']{10,}["']/gi,
  /["']?password["']?\s*[:=]\s*["'][^"']+["']/gi,
  /["']?token["']?\s*[:=]\s*["'][^"']{10,}["']/gi,
  /["']?secret["']?\s*[:=]\s*["'][^"']{10,}["']/gi,
];

@Injectable()
export class SanitizationService {
  sanitizeString(value: string): string {
    let result = value;
    for (const pattern of PII_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  sanitizeValue(value: unknown): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return this.sanitizeString(value);
    if (Array.isArray(value)) return value.map((v) => this.sanitizeValue(v));
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.sanitizeValue(v);
      }
      return result;
    }
    return value;
  }

  sanitizePayload(payload: Prisma.JsonValue): Prisma.JsonValue {
    return this.sanitizeValue(payload) as Prisma.JsonValue;
  }
}
