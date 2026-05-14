import { isUrlAllowed } from '../security/ssrf.guard';

export function assertSafeExternalUrl(url: string): void {
  if (!isUrlAllowed(url)) {
    throw new Error(`URL blocked by external URL policy: ${url}`);
  }
}
