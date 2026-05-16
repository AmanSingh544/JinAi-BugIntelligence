import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import type { ProviderSchema } from '../../../shared/provider-schema';

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

  useEffect(() => {
    if (!projectId) return;
    loadData();
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
      alert('Failed to add integration');
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
    try {
      const res = await api.integrations.validate(projectId, id);
      alert(res.valid ? 'Credentials valid' : `Invalid: ${res.error ?? 'Unknown error'}`);
    } catch (err) {
      console.error(err);
      alert('Validation failed');
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#e2e8f0' }}>Loading...</div>;

  const selectedSchema = getSchema(selectedProvider);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ color: '#e2e8f0', marginBottom: 24 }}>Integrations</h1>

      <button onClick={() => { setShowAdd(!showAdd); if (showAdd) resetForm(); }} style={{ marginBottom: 16 }}>
        {showAdd ? 'Cancel' : '+ Add Integration'}
      </button>

      {showAdd && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => { setSelectedProvider(e.target.value); setConfig({}); setGenericConfig(makeEmptyGenericConfig()); setBodyJsonError(''); }}
            >
              <option value="">Select...</option>
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
            <button onClick={addIntegration} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      )}

      {integrations.length === 0 ? (
        <p style={{ color: '#64748b' }}>No integrations configured.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {integrations.map((i) => {
            const schema = getSchema(i.provider_id);
            return (
              <div key={i.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{schema?.name ?? i.provider_id}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{i.is_active ? 'Active' : 'Inactive'}</div>
                </div>
                {projectId && canManage(projectId) && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="secondary" onClick={() => validateIntegration(i.id)}>Test</button>
                    <button className="secondary" onClick={() => toggleIntegration(i.id, i.is_active)}>
                      {i.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button className="danger" onClick={() => deleteIntegration(i.id)}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Managed Provider Form ───

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
    <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      {schema.fields.map((field: ProviderSchema['fields'][number]) => (
        <div key={field.name}>
          <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>
            {field.label}{field.required ? ' *' : ''}
          </label>
          {field.type === 'select' ? (
            <select
              value={config[field.name] ?? ''}
              onChange={(e) => onChange({ ...config, [field.name]: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="">Select...</option>
              {field.options?.map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === 'password' ? 'password' : 'text'}
              value={config[field.name] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => onChange({ ...config, [field.name]: e.target.value })}
              style={{ width: '100%' }}
            />
          )}
          {field.hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{field.hint}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Generic Provider Form ───

interface KeyValuePair {
  key: string;
  value: string;
}

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
    bodyTemplateString: JSON.stringify({
      title: '{{bug.summary}}',
      description: '{{bug.rootCause}}',
    }, null, 2),
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

  const addPair = (field: 'headers' | 'authCookies' | 'variables') => {
    update({ [field]: [...state[field], { key: '', value: '' }] } as Partial<GenericFormState>);
  };

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Base URL */}
      <div>
        <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Base URL *</label>
        <input
          type="text"
          value={state.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://tracker.internal.com"
          style={{ width: '100%' }}
        />
      </div>

      {/* Auth */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Authentication</div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Type</label>
          <select
            value={state.authType}
            onChange={(e) => update({ authType: e.target.value })}
            style={{ width: '100%' }}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="api_key">API Key</option>
            <option value="cookie">Cookie</option>
          </select>
        </div>

        {state.authType === 'bearer' && (
          <div>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Token</label>
            <input type="password" value={state.authToken} onChange={(e) => update({ authToken: e.target.value })} style={{ width: '100%' }} />
          </div>
        )}

        {state.authType === 'basic' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Username</label>
              <input type="text" value={state.authUsername} onChange={(e) => update({ authUsername: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Password</label>
              <input type="password" value={state.authPassword} onChange={(e) => update({ authPassword: e.target.value })} style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {state.authType === 'api_key' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Header Name</label>
              <input type="text" value={state.authHeaderName} onChange={(e) => update({ authHeaderName: e.target.value })} placeholder="X-API-Key" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>API Key</label>
              <input type="password" value={state.authApiKey} onChange={(e) => update({ authApiKey: e.target.value })} style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {state.authType === 'cookie' && (
          <div>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Cookies</label>
            {state.authCookies.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input type="text" placeholder="name" value={p.key} onChange={(e) => updatePair('authCookies', i, e.target.value, p.value)} style={{ flex: 1 }} />
                <input type="text" placeholder="value" value={p.value} onChange={(e) => updatePair('authCookies', i, p.key, e.target.value)} style={{ flex: 2 }} />
                <button className="danger" onClick={() => removePair('authCookies', i)}>×</button>
              </div>
            ))}
            <button className="secondary" onClick={() => addPair('authCookies')}>+ Add Cookie</button>
          </div>
        )}
      </div>

      {/* Endpoints */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Endpoints</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Health Check URL (optional)</label>
            <input type="text" value={state.healthCheckUrl} onChange={(e) => update({ healthCheckUrl: e.target.value })} placeholder="/api/health" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 3 }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Create Ticket URL *</label>
              <input type="text" value={state.createTicketUrl} onChange={(e) => update({ createTicketUrl: e.target.value })} placeholder="/api/v1/tickets" style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Method</label>
              <select value={state.createTicketMethod} onChange={(e) => update({ createTicketMethod: e.target.value })} style={{ width: '100%' }}>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Headers */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Headers (optional)</div>
        {state.headers.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input type="text" placeholder="Header" value={p.key} onChange={(e) => updatePair('headers', i, e.target.value, p.value)} style={{ flex: 1 }} />
            <input type="text" placeholder="Value" value={p.value} onChange={(e) => updatePair('headers', i, p.key, e.target.value)} style={{ flex: 2 }} />
            <button className="danger" onClick={() => removePair('headers', i)}>×</button>
          </div>
        ))}
        <button className="secondary" onClick={() => addPair('headers')}>+ Add Header</button>
      </div>

      {/* Body Template */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Body Template (JSON) *</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          Available: <code>{BUG_VARIABLES.map((v) => `{{bug.${v}}}`).join(' ')}</code>
          {' '}and <code>{'{{var.baseUrl}} {{var.YOUR_KEY}}'}</code>
        </div>
        <textarea
          value={state.bodyTemplateString}
          onChange={(e) => update({ bodyTemplateString: e.target.value })}
          rows={10}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
        {bodyJsonError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{bodyJsonError}</div>}
      </div>

      {/* Response Mapping */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Response Mapping</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Ticket ID Path *</label>
            <input type="text" value={state.ticketIdPath} onChange={(e) => update({ ticketIdPath: e.target.value })} placeholder="data.id" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Ticket URL Path (optional)</label>
            <input type="text" value={state.ticketUrlPath} onChange={(e) => update({ ticketUrlPath: e.target.value })} placeholder="data.url" style={{ width: '100%' }} />
          </div>
        </div>
      </div>

      {/* Variables */}
      <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 12 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Template Variables (optional)</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          Custom values available as <code>{'{{var.key}}'}</code> in URLs, headers, and body.
        </div>
        {state.variables.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input type="text" placeholder="key" value={p.key} onChange={(e) => updatePair('variables', i, e.target.value, p.value)} style={{ flex: 1 }} />
            <input type="text" placeholder="value" value={p.value} onChange={(e) => updatePair('variables', i, p.key, e.target.value)} style={{ flex: 2 }} />
            <button className="danger" onClick={() => removePair('variables', i)}>×</button>
          </div>
        ))}
        <button className="secondary" onClick={() => addPair('variables')}>+ Add Variable</button>
      </div>
    </div>
  );
}
