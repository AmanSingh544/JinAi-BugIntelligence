import { assertSafeExternalUrl } from '../validate-external-url';

describe('assertSafeExternalUrl', () => {
  it('does not throw for public URLs', () => {
    expect(() => assertSafeExternalUrl('https://api.github.com')).not.toThrow();
    expect(() => assertSafeExternalUrl('https://example.com/path')).not.toThrow();
  });

  it('throws for localhost', () => {
    expect(() => assertSafeExternalUrl('http://localhost:3000')).toThrow('blocked by external URL policy');
  });

  it('throws for private IPs', () => {
    expect(() => assertSafeExternalUrl('http://192.168.1.1')).toThrow('blocked by external URL policy');
  });
});
