import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Puzzle, Plus, X, CheckCircle2, XCircle, Pause, Play,
  Trash2, Shield, Globe, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import type { ProviderSchema } from '../../../shared/provider-schema';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { cn } from '../lib/utils';

interface Integration {
  id: string;
  project_id: string;
  provider_id: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

const BUG_VARIABLES = [
  'bugId', 'summary', 'rootCause', 'stepsToReproduce', 'fixSuggestion',
  'severity', 'errorMessage', 'stackTrace', 'affectedUrl', 'sessionId',
  'browser', 'timestamp',
];

export default function IntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canManage } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [schemas, setSchemas] = useState<ProviderSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [genericConfig, setGenericConfig] = useState<GenericFormState>(makeEmptyGenericConfig());
  const [bodyJsonError, setBodyJsonError] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void loadData();
  }, [projectId]);

  async function loadData() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [ints, provs] = await Promise.all([
        api.integrations.list(projectId),
        api.integrations.providers(),
      ]);
      setIntegrations(ints);
      setSchemas(provs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function getSchema(providerId: string): ProviderSchema | undefined {
    return schemas.find((s) => s.id === providerId);
  }

  function resetForm() {
    setSelectedProvider('');
    setConfig({});
    setGenericConfig(makeEmptyGenericConfig());
    setBodyJsonError('');
  }

  async function addIntegration() {
    if (!projectId || !selectedProvider) return;
    const schema = getSchema(selectedProvider);
    if (!schema) return;

    let payloadConfig: Record<string, unknown>;

    if (schema.type === 'generic') {
      const body = genericConfig.bodyTemplateString.trim();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        setBodyJsonError('Body template is not valid JSON');
        return;
      }
      setBodyJsonError('');
      payloadConfig = {
        schemaVersion: 1,
        baseUrl: genericConfig.baseUrl,
        auth: {
          type: genericConfig.authType,
          ...(genericConfig.authType === 'bearer' ? { token: genericConfig.authToken } : {}),
          ...(genericConfig.authType === 'basic' ? { username: genericConfig.authUsername, password: genericConfig.authPassword } : {}),
          ...(genericConfig.authType === 'api_key' ? { headerName: genericConfig.authHeaderName, apiKey: genericConfig.authApiKey } : {}),
          ...(genericConfig.authType === 'cookie' ? { cookies: keyValueArrayToRecord(genericConfig.authCookies) } : {}),
        },
        endpoints: {
          ...(genericConfig.healthCheckUrl ? { healthCheck: { url: genericConfig.healthCheckUrl, method: 'GET' } } : {}),
          createTicket: { url: genericConfig.createTicketUrl, method: genericConfig.createTicketMethod },
        },
        templates: {
          ...(Object.keys(keyValueArrayToRecord(genericConfig.headers)).length > 0
            ? { headers: keyValueArrayToRecord(genericConfig.headers) }
            : {}),
          body: parsedBody,
        },
        responseMapping: {
          ticketIdPath: genericConfig.ticketIdPath,
          ...(genericConfig.ticketUrlPath ? { ticketUrlPath: genericConfig.ticketUrlPath } : {}),
        },
        ...(Object.keys(keyValueArrayToRecord(genericConfig.variables)).length > 0
          ? { variables: keyValueArrayToRecord(genericConfig.variables) }
          : {}),
      };
    } else {
      payloadConfig = { ...config };
    }

    setSaving(true);
    try {
      await api.integrations.create(projectId, { provider_id: selectedProvider, config: payloadConfig });
      setShowAdd(false);
      resetForm();
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleIntegration(id: string, current: boolean) {
    if (!projectId) return;
    try {
      await api.integrations.update(projectId, id, { is_active: !current });
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteIntegration(id: string) {
    if (!projectId) return;
    if (!confirm('Delete this integration?')) return;
    try {
      await api.integrations.delete(projectId, id);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  async function validateIntegration(id: string) {
    if (!projectId) return;
    setValidating(id);
    setValidationMsg(null);
    try {
      const res = await api.integrations.validate(projectId, id);
      setValidationMsg({ id, ok: res.valid, msg: res.valid ? 'Credentials valid' : (res.error ?? 'Unknown error') });
    } catch {
      setValidationMsg({ id, ok: false, msg: 'Validation failed' });
    } finally {
      setValidating(null);
      setTimeout(() => setValidationMsg(null), 4000);
    }
  }

  const selectedSchema = getSchema(selectedProvider);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-th">Integrations</h1>
          <p className="text-xs text-th-3 mt-0.5">Connect external services for bug dispatch</p>
        </div>
        {canManage(projectId ?? '') && (
          <Button
            size="sm"
            variant={showAdd ? 'secondary' : 'primary'}
            onClick={() => { setShowAdd((v) => !v); if (showAdd) resetForm(); }}
          >
            {showAdd ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add Integration</>}
          </Button>
        )}
      </div>
      <div className="p-6 max-w-100% mx-auto w-full">

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mb-5"
          >
            <Card className="p-5">
              <CardHeader className="mb-4">
                <CardTitle>New Integration</CardTitle>
              </CardHeader>

              {/* Provider select */}
              <div className="mb-4">
                <label className="block text-[11px] font-medium text-th-3 uppercase tracking-wider mb-1.5">Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value);
                    setConfig({});
                    setGenericConfig(makeEmptyGenericConfig());
                    setBodyJsonError('');
                  }}
                  className="w-full bg-th-surface border border-th rounded-md text-sm text-th px-3 py-2 outline-none focus:border-indigo-500 transition-colors duration-150"
                >
                  <option value="">Select a provider...</option>
                  {schemas.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {selectedSchema?.type === 'managed' && (
                <ManagedProviderForm schema={selectedSchema} config={config} onChange={setConfig} />
              )}

              {selectedSchema?.type === 'generic' && (
                <GenericProviderForm
                  state={genericConfig}
                  onChange={setGenericConfig}
                  bodyJsonError={bodyJsonError}
                />
              )}

              {selectedProvider && (
                <div className="mt-5 pt-4 border-t border-th">
                  <Button size="sm" onClick={() => void addIntegration()} loading={saving}>
                    Save Integration
                  </Button>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Integration list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : integrations.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={18} />}
          title="No integrations yet"
          description="Connect Jira, GitHub, or any webhook-compatible service to dispatch bugs automatically."
        />
      ) : (
        <div className="space-y-2">
          {integrations.map((integration, idx) => {
            const schema = getSchema(integration.provider_id);
            const msg = validationMsg?.id === integration.id ? validationMsg : null;
            return (
              <motion.div
                key={integration.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="bg-th-surface border border-th rounded-lg px-4 py-3.5 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    'w-8 h-8 rounded-md border flex items-center justify-center flex-shrink-0',
                    integration.is_active
                      ? 'bg-indigo-500/10 border-indigo-500/30'
                      : 'bg-th-surface-2 border-th'
                  )}>
                    <Puzzle size={14} className={integration.is_active ? 'text-indigo-400' : 'text-th-3'} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-th">{schema?.name ?? integration.provider_id}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full', integration.is_active ? 'bg-green-400' : 'bg-zinc-600')} />
                      <span className="text-[11px] text-th-3">{integration.is_active ? 'Active' : 'Inactive'}</span>
                      {msg && (
                        <span className={cn('flex items-center gap-1 text-[11px] ml-2', msg.ok ? 'text-green-400' : 'text-red-400')}>
                          {msg.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                          {msg.msg}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {canManage(projectId ?? '') && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={validating === integration.id}
                      onClick={() => void validateIntegration(integration.id)}
                    >
                      Test
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => void toggleIntegration(integration.id, integration.is_active)}
                    >
                      {integration.is_active ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Activate</>}
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      onClick={() => void deleteIntegration(integration.id)}
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Managed Provider Form ─────────────────────────────────────────────────

function ManagedProviderForm({
  schema,
  config,
  onChange,
}: {
  schema: ProviderSchema;
  config: Record<string, string>;
  onChange: (c: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-3">
      {schema.fields.map((field: ProviderSchema['fields'][number]) => (
        <div key={field.name}>
          <label className="block text-[11px] font-medium text-th-3 uppercase tracking-wider mb-1.5">
            {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {field.type === 'select' ? (
            <select
              value={config[field.name] ?? ''}
              onChange={(e) => onChange({ ...config, [field.name]: e.target.value })}
              className="w-full bg-th-surface border border-th rounded-md text-sm text-th px-3 py-2 outline-none focus:border-indigo-500 transition-colors duration-150"
            >
              <option value="">Select...</option>
              {field.options?.map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <Input
              type={field.type === 'password' ? 'password' : 'text'}
              value={config[field.name] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange({ ...config, [field.name]: e.target.value })}
            />
          )}
          {field.hint && <p className="text-[11px] text-th-3 mt-1">{field.hint}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Generic Provider Form ─────────────────────────────────────────────────

interface KeyValuePair { key: string; value: string; }

interface GenericFormState {
  baseUrl: string;
  authType: string;
  authToken: string;
  authUsername: string;
  authPassword: string;
  authHeaderName: string;
  authApiKey: string;
  authCookies: KeyValuePair[];
  healthCheckUrl: string;
  createTicketUrl: string;
  createTicketMethod: string;
  headers: KeyValuePair[];
  bodyTemplateString: string;
  ticketIdPath: string;
  ticketUrlPath: string;
  variables: KeyValuePair[];
}

function makeEmptyGenericConfig(): GenericFormState {
  return {
    baseUrl: '',
    authType: 'none',
    authToken: '',
    authUsername: '',
    authPassword: '',
    authHeaderName: '',
    authApiKey: '',
    authCookies: [],
    healthCheckUrl: '',
    createTicketUrl: '',
    createTicketMethod: 'POST',
    headers: [],
    bodyTemplateString: JSON.stringify({ title: '{{bug.summary}}', description: '{{bug.rootCause}}' }, null, 2),
    ticketIdPath: 'data.id',
    ticketUrlPath: '',
    variables: [],
  };
}

function keyValueArrayToRecord(pairs: KeyValuePair[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const p of pairs) {
    if (p.key.trim()) rec[p.key.trim()] = p.value;
  }
  return rec;
}

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-medium text-th-3 uppercase tracking-wider mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function StyledSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-th-surface border border-th rounded-md text-sm text-th px-3 py-2 outline-none focus:border-indigo-500 transition-colors duration-150"
    >
      {children}
    </select>
  );
}

function KeyValueList({
  pairs,
  field,
  keyPlaceholder,
  valuePlaceholder,
  onAdd,
  onUpdate,
  onRemove,
}: {
  pairs: KeyValuePair[];
  field: 'headers' | 'authCookies' | 'variables';
  keyPlaceholder: string;
  valuePlaceholder: string;
  onAdd: () => void;
  onUpdate: (idx: number, key: string, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="space-y-2">
      {pairs.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            placeholder={keyPlaceholder}
            value={p.key}
            onChange={(e) => onUpdate(i, e.target.value, p.value)}
            className="flex-1 bg-th-surface border border-th rounded-md text-xs text-th px-2.5 py-1.5 outline-none focus:border-indigo-500 font-mono transition-colors duration-150"
          />
          <input
            type="text"
            placeholder={valuePlaceholder}
            value={p.value}
            onChange={(e) => onUpdate(i, p.key, e.target.value)}
            className="flex-[2] bg-th-surface border border-th rounded-md text-xs text-th px-2.5 py-1.5 outline-none focus:border-indigo-500 font-mono transition-colors duration-150"
          />
          <button
            onClick={() => onRemove(i)}
            className="text-th-3 hover:text-red-400 transition-colors duration-150 px-1"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={onAdd}
        className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors duration-150 flex items-center gap-1"
      >
        <Plus size={11} /> Add {field === 'authCookies' ? 'cookie' : field === 'headers' ? 'header' : 'variable'}
      </button>
    </div>
  );
}

function CollapsibleSection({ title, icon, defaultOpen = false, children }: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-th rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-th-surface-2/30 transition-colors duration-150"
      >
        <div className="flex items-center gap-2">
          <span className="text-th-3">{icon}</span>
          <span className="text-xs font-semibold text-th-2">{title}</span>
        </div>
        {open ? <ChevronUp size={13} className="text-th-3" /> : <ChevronDown size={13} className="text-th-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-th space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GenericProviderForm({
  state,
  onChange,
  bodyJsonError,
}: {
  state: GenericFormState;
  onChange: (s: GenericFormState) => void;
  bodyJsonError: string;
}) {
  const update = (patch: Partial<GenericFormState>) => onChange({ ...state, ...patch });

  const addPair = (field: 'headers' | 'authCookies' | 'variables') =>
    update({ [field]: [...state[field], { key: '', value: '' }] } as Partial<GenericFormState>);

  const updatePair = (field: 'headers' | 'authCookies' | 'variables', idx: number, key: string, value: string) => {
    const arr = [...state[field]];
    arr[idx] = { key, value };
    update({ [field]: arr } as Partial<GenericFormState>);
  };

  const removePair = (field: 'headers' | 'authCookies' | 'variables', idx: number) => {
    const arr = [...state[field]];
    arr.splice(idx, 1);
    update({ [field]: arr } as Partial<GenericFormState>);
  };

  return (
    <div className="space-y-3 mt-4">
      {/* Base URL */}
      <div>
        <FormLabel required>Base URL</FormLabel>
        <Input
          value={state.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://tracker.internal.com"
        />
      </div>

      {/* Auth */}
      <CollapsibleSection title="Authentication" icon={<Shield size={13} />} defaultOpen>
        <div>
          <FormLabel>Type</FormLabel>
          <StyledSelect value={state.authType} onChange={(v) => update({ authType: v })}>
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="api_key">API Key</option>
            <option value="cookie">Cookie</option>
          </StyledSelect>
        </div>

        <AnimatePresence mode="wait">
          {state.authType === 'bearer' && (
            <motion.div key="bearer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FormLabel>Token</FormLabel>
              <Input type="password" value={state.authToken} onChange={(e) => update({ authToken: e.target.value })} />
            </motion.div>
          )}
          {state.authType === 'basic' && (
            <motion.div key="basic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <div>
                <FormLabel>Username</FormLabel>
                <Input value={state.authUsername} onChange={(e) => update({ authUsername: e.target.value })} />
              </div>
              <div>
                <FormLabel>Password</FormLabel>
                <Input type="password" value={state.authPassword} onChange={(e) => update({ authPassword: e.target.value })} />
              </div>
            </motion.div>
          )}
          {state.authType === 'api_key' && (
            <motion.div key="api_key" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <div>
                <FormLabel>Header Name</FormLabel>
                <Input value={state.authHeaderName} onChange={(e) => update({ authHeaderName: e.target.value })} placeholder="X-API-Key" />
              </div>
              <div>
                <FormLabel>API Key</FormLabel>
                <Input type="password" value={state.authApiKey} onChange={(e) => update({ authApiKey: e.target.value })} />
              </div>
            </motion.div>
          )}
          {state.authType === 'cookie' && (
            <motion.div key="cookie" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FormLabel>Cookies</FormLabel>
              <KeyValueList
                pairs={state.authCookies}
                field="authCookies"
                keyPlaceholder="name"
                valuePlaceholder="value"
                onAdd={() => addPair('authCookies')}
                onUpdate={(i, k, v) => updatePair('authCookies', i, k, v)}
                onRemove={(i) => removePair('authCookies', i)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </CollapsibleSection>

      {/* Endpoints */}
      <CollapsibleSection title="Endpoints" icon={<Globe size={13} />} defaultOpen>
        <div>
          <FormLabel>Health Check URL</FormLabel>
          <Input
            value={state.healthCheckUrl}
            onChange={(e) => update({ healthCheckUrl: e.target.value })}
            placeholder="/api/health"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-[3]">
            <FormLabel required>Create Ticket URL</FormLabel>
            <Input
              value={state.createTicketUrl}
              onChange={(e) => update({ createTicketUrl: e.target.value })}
              placeholder="/api/v1/tickets"
            />
          </div>
          <div className="flex-1">
            <FormLabel>Method</FormLabel>
            <StyledSelect value={state.createTicketMethod} onChange={(v) => update({ createTicketMethod: v })}>
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
            </StyledSelect>
          </div>
        </div>
      </CollapsibleSection>

      {/* Headers */}
      <CollapsibleSection title="Headers" icon={<ChevronDown size={13} />}>
        <KeyValueList
          pairs={state.headers}
          field="headers"
          keyPlaceholder="Content-Type"
          valuePlaceholder="application/json"
          onAdd={() => addPair('headers')}
          onUpdate={(i, k, v) => updatePair('headers', i, k, v)}
          onRemove={(i) => removePair('headers', i)}
        />
      </CollapsibleSection>

      {/* Body Template */}
      <CollapsibleSection title="Body Template (JSON)" icon={<XCircle size={13} />} defaultOpen>
        <div className="text-[11px] text-th-3 font-mono leading-relaxed bg-th-bg border border-th rounded-md px-3 py-2 mb-2">
          {BUG_VARIABLES.map((v) => `{{bug.${v}}}`).join('  ')}
          {'  '}
          <span className="text-th-3">{'{{var.baseUrl}} {{var.YOUR_KEY}}'}</span>
        </div>
        <textarea
          value={state.bodyTemplateString}
          onChange={(e) => update({ bodyTemplateString: e.target.value })}
          rows={10}
          className="w-full bg-th-surface border border-th rounded-md text-xs text-th font-mono px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors duration-150 resize-y"
        />
        {bodyJsonError && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] mt-1">
            <AlertCircle size={11} />
            {bodyJsonError}
          </div>
        )}
      </CollapsibleSection>

      {/* Response Mapping */}
      <CollapsibleSection title="Response Mapping" icon={<CheckCircle2 size={13} />} defaultOpen>
        <div>
          <FormLabel required>Ticket ID Path</FormLabel>
          <Input
            value={state.ticketIdPath}
            onChange={(e) => update({ ticketIdPath: e.target.value })}
            placeholder="data.id"
            className="font-mono"
          />
          <p className="text-[11px] text-th-3 mt-1">JSONPath into response body to extract the ticket ID.</p>
        </div>
        <div>
          <FormLabel>Ticket URL Path</FormLabel>
          <Input
            value={state.ticketUrlPath}
            onChange={(e) => update({ ticketUrlPath: e.target.value })}
            placeholder="data.url"
            className="font-mono"
          />
        </div>
      </CollapsibleSection>

      {/* Variables */}
      <CollapsibleSection title="Template Variables" icon={<Puzzle size={13} />}>
        <p className="text-[11px] text-th-3">
          Custom values available as <code className="font-mono text-th-3">{'{{var.key}}'}</code> in URLs, headers, and body.
        </p>
        <KeyValueList
          pairs={state.variables}
          field="variables"
          keyPlaceholder="key"
          valuePlaceholder="value"
          onAdd={() => addPair('variables')}
          onUpdate={(i, k, v) => updatePair('variables', i, k, v)}
          onRemove={(i) => removePair('variables', i)}
        />
      </CollapsibleSection>
    </div>
  );
}
