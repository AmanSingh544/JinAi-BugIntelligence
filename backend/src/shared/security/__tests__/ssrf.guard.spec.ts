import { isUrlAllowed } from '../ssrf.guard';

describe('isUrlAllowed', () => {
  it('allows public HTTPS URLs', () => {
    expect(isUrlAllowed('https://example.com/api')).toBe(true);
    expect(isUrlAllowed('https://api.github.com')).toBe(true);
  });

  it('blocks localhost', () => {
    expect(isUrlAllowed('http://localhost:3000')).toBe(false);
    expect(isUrlAllowed('http://127.0.0.1')).toBe(false);
  });

  it('blocks private IPv4', () => {
    expect(isUrlAllowed('http://10.0.0.1')).toBe(false);
    expect(isUrlAllowed('http://192.168.1.1')).toBe(false);
    expect(isUrlAllowed('http://172.16.0.1')).toBe(false);
  });

  it('blocks metadata IP', () => {
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('blocks non-HTTP protocols', () => {
    expect(isUrlAllowed('ftp://example.com')).toBe(false);
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false);
  });
});
