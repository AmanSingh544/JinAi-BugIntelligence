import { bearerAuth, basicAuth, apiKeyAuth, tokenAuth } from '../auth-helpers';

describe('auth-helpers', () => {
  it('bearerAuth returns Authorization header', () => {
    expect(bearerAuth('tok_123')).toEqual({ Authorization: 'Bearer tok_123' });
  });

  it('basicAuth returns base64-encoded Authorization header', () => {
    const result = basicAuth('user', 'pass');
    expect(result).toHaveProperty('Authorization');
    expect(result.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(result.Authorization.replace('Basic ', ''), 'base64').toString('utf-8');
    expect(decoded).toBe('user:pass');
  });

  it('apiKeyAuth returns custom header', () => {
    expect(apiKeyAuth('X-Api-Key', 'key_123')).toEqual({ 'X-Api-Key': 'key_123' });
  });

  it('tokenAuth returns scheme-prefixed Authorization header', () => {
    expect(tokenAuth('token', 'ghp_123')).toEqual({ Authorization: 'token ghp_123' });
    expect(tokenAuth('Bearer', 'abc')).toEqual({ Authorization: 'Bearer abc' });
  });
});
