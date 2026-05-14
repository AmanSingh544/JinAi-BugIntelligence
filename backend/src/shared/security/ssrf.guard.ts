/**
 * SSRF protection for integration outbound requests.
 * Blocks localhost, private IP ranges, link-local, and cloud metadata endpoints.
 *
 * Env override: ALLOW_INTERNAL_INTEGRATION_URLS=true
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('SsrfGuard');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '[::]',
  '[::1]',
]);

const METADATA_IPS = new Set([
  '169.254.169.254', // AWS/GCP/Azure metadata
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b, c, d] = parts;

  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // loopback
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  // fe80::/10 link-local
  if (lower.startsWith('fe')) {
    const hex = parseInt(lower.slice(2, 4), 16);
    if ((hex & 0b11000000) === 0b10000000) return true;
  }
  // fc00::/7 unique local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // ::/128 unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

  return false;
}

export function isUrlAllowed(url: string): boolean {
  if (process.env.ALLOW_INTERNAL_INTEGRATION_URLS === 'true') {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    logger.warn(`SSRF blocked non-HTTP(S) protocol: ${protocol}`);
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    logger.warn(`SSRF blocked hostname: ${hostname}`);
    return false;
  }

  if (METADATA_IPS.has(hostname)) {
    logger.warn(`SSRF blocked metadata IP: ${hostname}`);
    return false;
  }

  if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
    logger.warn(`SSRF blocked private IP: ${hostname}`);
    return false;
  }

  return true;
}
