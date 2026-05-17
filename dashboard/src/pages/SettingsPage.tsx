import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Trash2, Plus, X, Archive, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, request, type Environment } from '../api';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';

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
  return Object.fromEntries((PROVIDER_FIELDS[provider] ?? []).map((f) => [f.key, f.key === 'smtp_port' ? '587' : '']));
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
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => { if (projectId) void loadData(); }, [projectId]);
  useEffect(() => { setChannelFields(getDefaultConfig(channelProvider)); }, [channelProvider]);

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
    } catch { /* quiet */ }
    finally { setLoading(false); }
  }

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function updateEnv(envId: string, dto: Partial<Environment>) {
    if (!projectId) return;
    setSaving((prev) => ({ ...prev, [envId]: true }));
    try {
      const updated = await api.environments.update(projectId, envId, dto);
      setEnvs((prev) => prev.map((e) => (e.id === envId ? updated : e)));
    } catch { showFeedback('error', 'Failed to update environment'); }
    finally { setSaving((prev) => ({ ...prev, [envId]: false })); }
  }

  async function addChannel() {
    if (!projectId || !channelName) return;
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(channelFields)) {
      config[k] = k === 'smtp_port' ? (parseInt(v, 10) || 587) : v;
    }
    try {
      await request(`/projects/${projectId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ provider_id: channelProvider, name: channelName, config }),
      });
      setShowChannelForm(false);
      setChannelName('');
      setChannelProvider('slack');
      setChannelFields(getDefaultConfig('slack'));
      await loadData();
      showFeedback('success', 'Channel added');
    } catch { showFeedback('error', 'Failed to add channel'); }
  }

  async function deleteChannel(id: string) {
    if (!projectId || !confirm('Delete this channel?')) return;
    try {
      await request(`/projects/${projectId}/channels/${id}`, { method: 'DELETE' });
      setChannels((prev) => prev.filter((c) => c.id !== id));
      showFeedback('success', 'Channel deleted');
    } catch { showFeedback('error', 'Failed to delete channel'); }
  }

  async function testChannel(id: string) {
    if (!projectId) return;
    try {
      const res = await request<{ success: boolean; error?: string }>(`/projects/${projectId}/channels/${id}/test`, { method: 'POST' });
      showFeedback(res.success ? 'success' : 'error', res.success ? 'Test passed!' : `Test failed: ${res.error ?? 'Unknown'}`);
    } catch { showFeedback('error', 'Test failed'); }
  }

  async function toggleChannelActive(id: string, isActive: boolean) {
    if (!projectId) return;
    try {
      await request(`/projects/${projectId}/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !isActive }),
      });
      setChannels((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !isActive } : c));
    } catch { showFeedback('error', 'Failed to update channel'); }
  }

  const canEdit = projectId ? canManage(projectId) : false;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <h1 className="text-base font-bold text-th">Settings</h1>
        <p className="text-xs text-th-3 mt-0.5">Configure your project</p>
      </div>
      <div className="p-6 max-w-100% mx-auto w-full">

        {/* Feedback toast */}
        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg mb-4 text-xs font-medium',
                feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
              )}
            >
              {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
              {feedback.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-th-surface border border-th rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Notification channels */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-th">Notification Channels</h2>
                  <p className="text-[11px] text-th-3 mt-0.5">Receive alerts via Slack, email, or Teams</p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setShowChannelForm((v) => !v)}>
                    {showChannelForm ? <X size={12} /> : <Plus size={12} />}
                    {showChannelForm ? 'Cancel' : 'Add'}
                  </Button>
                )}
              </div>

              <AnimatePresence>
                {showChannelForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden mb-3"
                  >
                    <Card>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[11px] font-medium text-th-3 block mb-1.5">Provider</label>
                            <Select value={channelProvider} onChange={(e) => setChannelProvider(e.target.value)} className="w-full">
                              <option value="slack">Slack</option>
                              <option value="email">Email</option>
                              <option value="teams">Microsoft Teams</option>
                            </Select>
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-th-3 block mb-1.5">Name</label>
                            <Input
                              placeholder="#alerts or team@example.com"
                              value={channelName}
                              onChange={(e) => setChannelName(e.target.value)}
                            />
                          </div>
                        </div>
                        {(PROVIDER_FIELDS[channelProvider] ?? []).map((field) => (
                          <div key={field.key}>
                            <label className="text-[11px] font-medium text-th-3 block mb-1.5">{field.label}</label>
                            <Input
                              type={field.type ?? 'text'}
                              value={channelFields[field.key] ?? ''}
                              onChange={(e) => setChannelFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              placeholder={field.placeholder}
                            />
                          </div>
                        ))}
                        <Button size="sm" onClick={() => void addChannel()} disabled={!channelName}>
                          Save Channel
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {channels.length === 0 ? (
                <EmptyState
                  icon={<Bell size={16} />}
                  title="No notification channels"
                  description="Add Slack, Teams, or email channels to receive bug alerts."
                />
              ) : (
                <div className="space-y-2">
                  {channels.map((ch) => (
                    <div key={ch.id} className="flex items-center justify-between gap-3 bg-th-surface border border-th rounded-lg px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn('w-2 h-2 rounded-full', ch.is_active ? 'bg-green-400' : 'bg-zinc-600')} />
                        <div>
                          <div className="text-xs font-medium text-th">{ch.name}</div>
                          <div className="text-[10px] text-th-3 capitalize">{ch.provider_id}</div>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void toggleChannelActive(ch.id, ch.is_active)}
                            className={cn(
                              'text-[11px] font-medium px-2 py-0.5 rounded border transition-colors duration-150',
                              ch.is_active
                                ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20'
                                : 'bg-th-surface-2 text-th-3 border-th hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/20'
                            )}
                          >
                            {ch.is_active ? 'Active' : 'Inactive'}
                          </button>
                          <Button size="xs" variant="ghost" onClick={() => void testChannel(ch.id)}>Test</Button>
                          <Button size="xs" variant="danger" onClick={() => void deleteChannel(ch.id)}>
                            <Trash2 size={10} />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Data retention */}
            <section>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-th">Data Retention</h2>
                <p className="text-[11px] text-th-3 mt-0.5">Manage storage of historical bug data</p>
              </div>
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Archive size={14} className="text-amber-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-th mb-1">Archive Old Bugs</div>
                      <p className="text-xs text-th-3 max-w-sm">
                        Move resolved and ignored bugs older than 90 days to cold storage. They remain restorable but are hidden from default views.
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        if (!projectId || !confirm('Archive resolved/ignored bugs older than 90 days?')) return;
                        try {
                          const res = await api.bugs.archiveOld(projectId);
                          showFeedback('success', `${res.message} (Job: ${res.jobId})`);
                        } catch (err) {
                          showFeedback('error', (err as Error).message);
                        }
                      }}
                    >
                      Archive Now
                    </Button>
                  )}
                </div>
              </Card>
            </section>

            {/* Environments */}
            <section>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-th">Environments</h2>
                <p className="text-[11px] text-th-3 mt-0.5">Configure capture and replay settings per environment</p>
              </div>
              <div className="space-y-3">
                {envs.map((env) => (
                  <Card key={env.id}>
                    <CardHeader>
                      <div>
                        <CardTitle className="capitalize">{env.name}</CardTitle>
                        <span className="text-[10px] text-th-3">v{env.config_version}</span>
                      </div>
                      {saving[env.id] && <Loader2 size={13} className="text-th-3 animate-spin" />}
                    </CardHeader>

                    <div className="space-y-4">
                      {/* Toggles */}
                      <div className="grid grid-cols-2 gap-3">
                        <ToggleRow
                          label="Session Replay"
                          description="Record user sessions"
                          checked={env.replay_enabled}
                          onChange={(v) => void updateEnv(env.id, { replay_enabled: v })}
                          disabled={saving[env.id] || !canEdit}
                        />
                        <ToggleRow
                          label="Screenshot on Error"
                          description="Capture screenshots"
                          checked={env.screenshot_on_error}
                          onChange={(v) => void updateEnv(env.id, { screenshot_on_error: v })}
                          disabled={saving[env.id] || !canEdit}
                        />
                      </div>

                      {/* Sampling */}
                      <div>
                        <div className="text-[10px] font-semibold text-th-3 uppercase tracking-widest mb-2">Sampling Rates</div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'sampling_click', label: 'Click', value: env.sampling_click },
                            { key: 'sampling_navigation', label: 'Navigation', value: env.sampling_navigation },
                            { key: 'sampling_console', label: 'Console', value: env.sampling_console },
                            { key: 'sampling_api', label: 'API', value: env.sampling_api },
                            { key: 'sampling_error', label: 'Error', value: env.sampling_error },
                          ].map((s) => (
                            <div key={s.key}>
                              <label className="text-[10px] text-th-3 block mb-1">{s.label}</label>
                              <input
                                type="number"
                                min={0} max={1} step={0.01}
                                value={s.value}
                                onChange={(e) => void updateEnv(env.id, { [s.key]: parseFloat(e.target.value) })}
                                disabled={saving[env.id] || !canEdit}
                                className="w-full h-7 bg-th-surface-2 border border-th rounded-md px-2 text-xs text-th-2 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled }: {
  label: string; description: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-3 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative w-8 h-4 rounded-full transition-colors duration-200 flex-shrink-0 mt-0.5',
          checked ? 'bg-indigo-500' : 'bg-zinc-700'
        )}
      >
        <div className={cn(
          'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )} />
      </div>
      <div>
        <div className="text-xs font-medium text-th-2">{label}</div>
        <div className="text-[10px] text-th-3">{description}</div>
      </div>
    </label>
  );
}
