import { ProviderError } from '../../modules/integrations/providers/provider-error';
import { HTTP_CLIENT_DEFAULTS } from './http-client.constants';

export async function readJsonResponse<T>(
  providerId: string,
  res: Response,
  maxBytes?: number,
): Promise<T> {
  const limit = maxBytes ?? HTTP_CLIENT_DEFAULTS.maxResponseBytes;

  // Validate content type before attempting JSON parse
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const snippet = await readTextWithLimit(res, Math.min(limit, 5_000));
    throw new ProviderError({
      providerId,
      message: `Unexpected response content-type: "${contentType}". Body: ${snippet.slice(0, 200)}`,
      statusCode: res.status,
    });
  }

  const text = await readTextWithLimit(res, limit);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError({
      providerId,
      message: 'Invalid JSON in response body',
      statusCode: res.status,
    });
  }
}

async function readTextWithLimit(res: Response, limitBytes: number): Promise<string> {
  if (!res.body) return '';

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.length;
      if (total > limitBytes) {
        throw new Error(`Response body exceeds ${limitBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(concatUint8Arrays(chunks));
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
