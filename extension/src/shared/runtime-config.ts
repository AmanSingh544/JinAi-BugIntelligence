export interface SdkConfig {
  version: number;
  environment: string;
  sampling: {
    click: number;
    navigation: number;
    console: number;
    api: number;
    error: number;
  };
  replayEnabled: boolean;
  screenshotOnError: boolean;
}

const DEFAULT_CONFIG: SdkConfig = {
  version: 1,
  environment: 'production',
  sampling: {
    click: 1.0,
    navigation: 1.0,
    console: 1.0,
    api: 1.0,
    error: 1.0,
  },
  replayEnabled: false,
  screenshotOnError: false,
};

const CONFIG_KEY = 'bi_runtime_config';
const CONFIG_VERSION_KEY = 'bi_runtime_config_version';
const CONFIG_FETCHED_AT_KEY = 'bi_runtime_config_fetched_at';
const POLL_INTERVAL_MS = 60_000;

let _cached: SdkConfig | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function getRuntimeConfig(): SdkConfig {
  if (_cached) return _cached;
  // Try sync read from storage (best-effort, real value comes from background)
  return DEFAULT_CONFIG;
}

export async function loadRuntimeConfig(): Promise<SdkConfig> {
  const result = await chrome.storage.local.get([
    CONFIG_KEY,
    CONFIG_VERSION_KEY,
    CONFIG_FETCHED_AT_KEY,
  ]);

  const stored = result[CONFIG_KEY] as SdkConfig | undefined;
  if (stored) {
    _cached = stored;
    return stored;
  }

  return DEFAULT_CONFIG;
}

export async function saveRuntimeConfig(config: SdkConfig): Promise<void> {
  _cached = config;
  await chrome.storage.local.set({
    [CONFIG_KEY]: config,
    [CONFIG_VERSION_KEY]: config.version,
    [CONFIG_FETCHED_AT_KEY]: Date.now(),
  });
}

export async function fetchRuntimeConfig(
  apiKey: string,
  ingestUrl: string,
  envName?: string,
): Promise<SdkConfig | null> {
  const sdkUrl = ingestUrl.replace('/ingest/batch', '/sdk/config');
  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
  };
  if (envName) headers['X-BI-Environment'] = envName;

  try {
    const res = await fetch(sdkUrl, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as SdkConfig;
    return data;
  } catch {
    return null;
  }
}

export async function syncRuntimeConfig(
  apiKey: string,
  ingestUrl: string,
  envName?: string,
): Promise<void> {
  const fresh = await fetchRuntimeConfig(apiKey, ingestUrl, envName);
  if (!fresh) return;

  const current = await loadRuntimeConfig();
  if (fresh.version > current.version) {
    await saveRuntimeConfig(fresh);
  }
}

export function startConfigPolling(
  apiKey: string,
  ingestUrl: string,
  envName?: string,
): void {
  if (_pollTimer) return;
  void syncRuntimeConfig(apiKey, ingestUrl, envName);
  _pollTimer = setInterval(() => {
    void syncRuntimeConfig(apiKey, ingestUrl, envName);
  }, POLL_INTERVAL_MS);
}

export function stopConfigPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export function shouldTrack(eventType: string): boolean {
  const cfg = getRuntimeConfig();
  const rate = cfg.sampling[eventType as keyof typeof cfg.sampling];
  if (rate === undefined) return true;
  if (eventType === 'error') return true; // safety
  return Math.random() < rate;
}

export function isReplayEnabled(): boolean {
  return getRuntimeConfig().replayEnabled;
}

export function isScreenshotOnError(): boolean {
  return getRuntimeConfig().screenshotOnError;
}

export function getEnvironmentName(): string {
  return getRuntimeConfig().environment;
}
