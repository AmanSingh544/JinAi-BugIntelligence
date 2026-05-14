import { readJsonResponse } from '../read-json-response';
import { ProviderError } from '../../../modules/integrations/providers/provider-error';

describe('readJsonResponse', () => {
  it('parses valid JSON response', async () => {
    const res = new Response('{"id":"123"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const data = await readJsonResponse<{ id: string }>('test', res);
    expect(data.id).toBe('123');
  });

  it('rejects non-JSON content-type', async () => {
    const res = new Response('<html>error</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    await expect(readJsonResponse('test', res)).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects invalid JSON', async () => {
    const res = new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(readJsonResponse('test', res)).rejects.toBeInstanceOf(ProviderError);
  });
});
