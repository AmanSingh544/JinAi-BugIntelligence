import { GenericHttpProvider } from './generic-http.provider';
import { ProviderError } from './provider-error';
import type { BugReportPayload } from './integration.interface';

// Mock the HTTP utilities
jest.mock('../../../shared/http/external-api-fetch', () => ({
  externalApiFetch: jest.fn(),
}));

jest.mock('../../../shared/http/read-json-response', () => ({
  readJsonResponse: jest.fn(),
}));

import { externalApiFetch } from '../../../shared/http/external-api-fetch';
import { readJsonResponse } from '../../../shared/http/read-json-response';

describe('GenericHttpProvider', () => {
  let provider: GenericHttpProvider;

  beforeEach(() => {
    provider = new GenericHttpProvider();
    jest.clearAllMocks();
  });

  const validConfig = () => ({
    baseUrl: 'https://tracker.example.com',
    auth: { type: 'none' },
    endpoints: {
      healthCheck: { url: '/health', method: 'GET' },
      createTicket: { url: '/tickets', method: 'POST' },
    },
    templates: {
      headers: { 'x-custom': 'value' },
      body: { title: '{{bug.summary}}', description: '{{bug.rootCause}}' },
    },
    responseMapping: { ticketIdPath: 'data.id', ticketUrlPath: 'data.url' },
  });

  const bugPayload = (): BugReportPayload => ({
    bugId: 'b1',
    projectId: 'p1',
    summary: 'Crash on login',
    rootCause: 'Null pointer',
    stepsToReproduce: [],
    fixSuggestion: '',
    severity: 'high',
    errorMessage: 'TypeError',
    stackTrace: '',
    sessionUrl: 'http://localhost:5173/sessions/s1',
    affectedUrl: 'http://app/login',
    sessionId: 's1',
    browser: 'Chrome',
    timestamp: new Date().toISOString(),
  });

  describe('validateCredentials', () => {
    it('returns true when health check succeeds', async () => {
      (externalApiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      const result = await provider.validateCredentials(validConfig());

      expect(result).toBe(true);
      expect(externalApiFetch).toHaveBeenCalledWith('generic_http', expect.objectContaining({
        url: 'https://tracker.example.com/health',
        method: 'GET',
      }));
    });

    it('returns false when health check fails', async () => {
      (externalApiFetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      const result = await provider.validateCredentials(validConfig());

      expect(result).toBe(false);
    });

    it('validates structure when no health check endpoint', async () => {
      const cfg = validConfig();
      delete (cfg as any).endpoints.healthCheck;

      const result = await provider.validateCredentials(cfg);

      expect(result).toBe(true);
      expect(externalApiFetch).not.toHaveBeenCalled();
    });

    it('returns false for incomplete config', async () => {
      const result = await provider.validateCredentials({ baseUrl: 'https://x.com' });
      expect(result).toBe(false);
    });
  });

  describe('createTicket', () => {
    it('creates ticket with rendered templates', async () => {
      (externalApiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });
      (readJsonResponse as jest.Mock).mockResolvedValue({ data: { id: 'T-123', url: 'https://tracker.example.com/tickets/T-123' } });

      const result = await provider.createTicket(bugPayload(), validConfig());

      expect(result.ticketId).toBe('T-123');
      expect(result.url).toBe('https://tracker.example.com/tickets/T-123');
      expect(externalApiFetch).toHaveBeenCalledWith('generic_http', expect.objectContaining({
        url: 'https://tracker.example.com/tickets',
        method: 'POST',
        headers: expect.objectContaining({
          'x-custom': 'value',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('Crash on login'),
      }));
    });

    it('throws when ticket ID is missing from response', async () => {
      (externalApiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });
      (readJsonResponse as jest.Mock).mockResolvedValue({ data: { url: 'http://x' } });

      await expect(provider.createTicket(bugPayload(), validConfig())).rejects.toThrow(ProviderError);
    });

    it('uses bearer auth when configured', async () => {
      const cfg = {
        ...validConfig(),
        auth: { type: 'bearer', token: 'secret-token' },
      };
      (externalApiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });
      (readJsonResponse as jest.Mock).mockResolvedValue({ data: { id: 'T-1' } });

      await provider.createTicket(bugPayload(), cfg);

      const callArgs = (externalApiFetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers).toMatchObject({
        Authorization: 'Bearer secret-token',
      });
    });

    it('uses basic auth when configured', async () => {
      const cfg = {
        ...validConfig(),
        auth: { type: 'basic', username: 'user', password: 'pass' },
      };
      (externalApiFetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });
      (readJsonResponse as jest.Mock).mockResolvedValue({ data: { id: 'T-1' } });

      await provider.createTicket(bugPayload(), cfg);

      const callArgs = (externalApiFetch as jest.Mock).mock.calls[0][1];
      expect(callArgs.headers.Authorization).toMatch(/^Basic /);
    });
  });

  describe('updateTicket', () => {
    it('logs warning and does nothing', async () => {
      const loggerWarnSpy = jest.spyOn((provider as any).logger, 'warn').mockImplementation(() => {});
      await provider.updateTicket('T-123', bugPayload(), validConfig());
      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });
  });
});
