import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, request, type Environment } from '../api';
import { useAuth } from '../hooks/useAuth';

type Channel = { id: string; provider_id: string; name: string; is_active: boolean };

const PROVIDER_FIELDS: Record<string, Array<{ key: string; label: string; type?: string; placeholder?: string }>> = {
  slack: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' }],
  teams: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://outlook.office.com/webhook/...' }],
  email: [
    { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
    { key: 'smtp_port', label: 'SMTP Port', type: 'number', placeholder: '587' },
    { key: 'smtp_user', label: 'SMTP Username', placeholder: 'user@example.com' },
    { key: 'smtp_pass', label: 'SMTP Password', type: 'password', placeholder: '••••••••' },
    { key: 'from', label: 'From Address', placeholder: 'alerts@example.com' },
    { key: 'to', label: 'To Address', placeholder: 'team@example.com' },
  ],
};

function getDefaultConfig(provider: string): Record<string, string> {
  const fields = PROVIDER_FIELDS[provider] ?? [];
  const config: Record<string, string> = {};
  for (const f of fields) {
    config[f.key] = f.key === 'smtp_port' ? '587' : '';
  }
  return config;
}

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canManage } = useAuth();
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelProvider, setChannelProvider] = useState('slack');
  const [channelName, setChannelName] = useState('');
  const [channelFields, setChannelFields] = useState<Record<string, string>>(() => getDefaultConfig('slack'));

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  useEffect(() => {
    setChannelFields(getDefaultConfig(channelProvider));
  }, [channelProvider]);

  async function loadData() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [e, c] = await Promise.all([
        api.environments.list(projectId),
        request<Channel[]>(`/projects/${projectId}/channels`),
      ]);
      setEnvs(e);
      setChannels(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function updateEnv(envId: string, dto: Partial<Environment>) {
    if (!projectId) return;
    setSaving((prev) => ({ ...prev, [envId]: true }));
    try {
      const updated = await api.environments.update(projectId, envId, dto);
      setEnvs((prev) => prev.map((e) => (e.id === envId ? updated : e)));
    } catch (err) {
      console.error(err);
      alert('Failed to update environment');
    } finally {
      setSaving((prev) => ({ ...prev, [envId]: false }));
    }
  }

  async function addChannel() {
    if (!projectId || !channelName) return;
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(channelFields)) {
      if (k === 'smtp_port') {
        config[k] = parseInt(v, 10) || 587;
      } else {
        config[k] = v;
      }
    }
    try {
      await request(`/projects/${projectId}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          provider_id: channelProvider,
          name: channelName,
          config,
        }),
      });
      setShowChannelForm(false);
      setChannelName('');
      setChannelProvider('slack');
      setChannelFields(getDefaultConfig('slack'));
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Failed to add channel');
    }
  }

  async function deleteChannel(id: string) {
    if (!projectId) return;
    if (!confirm('Delete this channel?')) return;
    try {
      await request(`/projects/${projectId}/channels/${id}`, { method: 'DELETE' });
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  async function testChannel(id: string) {
    if (!projectId) return;
    try {
      const res = await request<{ success: boolean; error?: string }>(`/projects/${projectId}/channels/${id}/test`, { method: 'POST' });
      alert(res.success ? 'Test passed' : `Test failed: ${res.error ?? 'Unknown'}`);
    } catch (err) {
      console.error(err);
      alert('Test failed');
    }
  }

  async function toggleChannelActive(id: string, isActive: boolean) {
    if (!projectId) return;
    try {
      await request(`/projects/${projectId}/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !isActive }),
      });
      setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: !isActive } : c)));
    } catch (err) {
      console.error(err);
      alert('Failed to update channel');
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#e2e8f0' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#6366f1', textDecoration: 'none' }}>← Projects</Link>
        <h1 style={{ marginTop: 12, color: '#e2e8f0' }}>Project Settings</h1>
      </div>

      <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Notification Channels</h2>
      {projectId && canManage(projectId) && (
        <button onClick={() => setShowChannelForm(!showChannelForm)} style={{ marginBottom: 16 }}>
          {showChannelForm ? 'Cancel' : '+ Add Channel'}
        </button>
      )}

      {showChannelForm && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Provider</label>
            <select value={channelProvider} onChange={(e) => setChannelProvider(e.target.value)}>
              <option value="slack">Slack</option>
              <option value="email">Email</option>
              <option value="teams">Microsoft Teams</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Name</label>
            <input type="text" value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="#alerts or team@example.com" />
          </div>
          {(PROVIDER_FIELDS[channelProvider] ?? []).map((field) => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>{field.label}</label>
              <input
                type={field.type ?? 'text'}
                value={channelFields[field.key] ?? ''}
                onChange={(e) => setChannelFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                style={{ width: '100%' }}
              />
            </div>
          ))}
          {projectId && canManage(projectId) && <button onClick={addChannel}>Save Channel</button>}
        </div>
      )}

      {channels.length === 0 ? (
        <p style={{ color: '#64748b', marginBottom: 32 }}>No notification channels.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginBottom: 32 }}>
          {channels.map((ch) => (
            <div key={ch.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{ch.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{ch.provider_id} · {ch.is_active ? 'Active' : 'Inactive'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {projectId && canManage(projectId) && (
                  <>
                    <ToggleField
                      label="Active"
                      value={ch.is_active}
                      onChange={() => toggleChannelActive(ch.id, ch.is_active)}
                    />
                    <button className="secondary" onClick={() => testChannel(ch.id)}>Test</button>
                    <button className="danger" onClick={() => deleteChannel(ch.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Data Retention</h2>
      <div className="card" style={{ marginBottom: 32, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>Archive Old Bugs</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Move resolved/ignored bugs older than 90 days to cold storage. They will be hidden from default views but can be restored.
            </div>
          </div>
          {projectId && canManage(projectId) && (
            <button
              className="secondary"
              onClick={async () => {
                if (!projectId) return;
                if (!window.confirm('Archive resolved/ignored bugs older than 90 days?')) return;
                try {
                  const res = await api.bugs.archiveOld(projectId);
                  alert(res.message + ' (Job ID: ' + res.jobId + ')');
                } catch (err) {
                  alert('Failed: ' + (err as Error).message);
                }
              }}
            >
              Archive Now
            </button>
          )}
        </div>
      </div>

      <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Environments</h2>
      {envs.map((env) => (
        <div key={env.id} className="card" style={{ marginBottom: 24, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#e2e8f0', textTransform: 'capitalize' }}>{env.name}</h3>
            <span style={{ color: '#64748b', fontSize: 12 }}>v{env.config_version}</span>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ToggleField
                label="Replay Enabled"
                value={env.replay_enabled}
                onChange={(v) => updateEnv(env.id, { replay_enabled: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
              <ToggleField
                label="Screenshot on Error"
                value={env.screenshot_on_error}
                onChange={(v) => updateEnv(env.id, { screenshot_on_error: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
            </div>

            <h4 style={{ color: '#64748b', margin: '8px 0 4px', fontSize: 12, textTransform: 'uppercase' }}>Sampling Rates</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <SamplingField
                label="Click"
                value={env.sampling_click}
                onChange={(v) => updateEnv(env.id, { sampling_click: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
              <SamplingField
                label="Navigation"
                value={env.sampling_navigation}
                onChange={(v) => updateEnv(env.id, { sampling_navigation: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
              <SamplingField
                label="Console"
                value={env.sampling_console}
                onChange={(v) => updateEnv(env.id, { sampling_console: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
              <SamplingField
                label="API"
                value={env.sampling_api}
                onChange={(v) => updateEnv(env.id, { sampling_api: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
              <SamplingField
                label="Error"
                value={env.sampling_error}
                onChange={(v) => updateEnv(env.id, { sampling_error: v })}
                disabled={saving[env.id] || (projectId ? !canManage(projectId) : true)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToggleField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function SamplingField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ width: '100%' }}
      />
    </div>
  );
}
