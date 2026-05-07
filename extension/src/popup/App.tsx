import React, { useEffect, useState } from 'react';

const DEFAULT_INGEST_URL = 'http://localhost:4000/api/v1/ingest/batch';

interface Config {
  apiKey: string;
  ingestUrl: string;
  enabled: boolean;
}

const wrap: React.CSSProperties = { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' };
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const title: React.CSSProperties = { fontSize: '14px', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' };
const label: React.CSSProperties = { fontSize: '11px', color: '#94a3b8', marginBottom: '4px' };
const input: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: '12px',
  background: '#1e2332', border: '1px solid #374151', borderRadius: '6px', color: '#e2e8f0', outline: 'none',
};
const footer: React.CSSProperties = { fontSize: '10px', color: '#4b5563', textAlign: 'center' };
const saved: React.CSSProperties = { fontSize: '11px', color: '#34d399', textAlign: 'center' };

function badge(on: boolean): React.CSSProperties {
  return {
    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
    background: on ? '#16a34a' : '#374151', color: on ? '#dcfce7' : '#9ca3af',
  };
}

function toggle(on: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '8px', fontSize: '13px', fontWeight: 600,
    border: 'none', borderRadius: '6px', cursor: 'pointer',
    background: on ? '#1d4ed8' : '#16a34a', color: '#fff', transition: 'background 0.15s',
  };
}

export default function App() {
  const [config, setConfig] = useState<Config>({ apiKey: '', ingestUrl: DEFAULT_INGEST_URL, enabled: false });
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'ingestUrl', 'enabled'], (r) => {
      setConfig({
        apiKey: (r['apiKey'] as string | undefined) ?? '',
        ingestUrl: (r['ingestUrl'] as string | undefined) ?? DEFAULT_INGEST_URL,
        enabled: (r['enabled'] as boolean | undefined) ?? false,
      });
    });
  }, []);

  function save(partial: Partial<Config>) {
    const next = { ...config, ...partial };
    setConfig(next);
    chrome.storage.local.set({ apiKey: next.apiKey, ingestUrl: next.ingestUrl, enabled: next.enabled }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 1500);
    });
  }

  return (
    <div style={wrap}>
      <div style={header}>
        <span style={title}>Bug Intelligence</span>
        <span style={badge(config.enabled)}>{config.enabled ? 'Active' : 'Paused'}</span>
      </div>

      <div>
        <div style={label}>Project API Key</div>
        <input
          style={input} type="password" placeholder="bi_live_••••••••"
          value={config.apiKey}
          onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
          onBlur={() => save({ apiKey: config.apiKey })}
        />
      </div>

      <div>
        <div style={label}>Ingest URL</div>
        <input
          style={input} type="text"
          value={config.ingestUrl}
          onChange={(e) => setConfig((c) => ({ ...c, ingestUrl: e.target.value }))}
          onBlur={() => save({ ingestUrl: config.ingestUrl })}
        />
      </div>

      <button style={toggle(config.enabled)} onClick={() => save({ enabled: !config.enabled })}>
        {config.enabled ? 'Pause Capture' : 'Start Capture'}
      </button>

      {isSaved && <div style={saved}>Saved</div>}
      <div style={footer}>Events flush every 5 s · max 20 per batch</div>
    </div>
  );
}
