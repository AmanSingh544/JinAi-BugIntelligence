import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { request } from '../api';
import { useAuth } from '../hooks/useAuth';

interface Rule {
  id: string;
  project_id: string;
  name: string;
  conditions: { operator: 'all' | 'any'; conditions: Array<{ field: string; op: string; value: string | number }> };
  action: string;
  is_active: boolean;
  created_at: string;
}

const FIELDS = [
  { value: 'error.severity', label: 'Severity' },
  { value: 'error.status_code', label: 'Status Code' },
  { value: 'cluster.occurrences', label: 'Occurrences' },
  { value: 'session.unique_users', label: 'Unique Users' },
];

const OPS = ['=', '>=', '<=', '>'];

const ACTIONS = ['auto_dispatch', 'notify', 'ignore'];

export default function RulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canManage } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [operator, setOperator] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<Array<{ field: string; op: string; value: string }>>([{ field: 'error.severity', op: '>=', value: 'high' }]);
  const [action, setAction] = useState('auto_dispatch');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    loadRules();
  }, [projectId]);

  async function loadRules() {
    if (!projectId) return;
    setLoading(true);
    try {
      const rows = await request<Rule[]>(`/projects/${projectId}/rules`);
      setRules(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function createRule() {
    if (!projectId || !name) return;
    setSaving(true);
    try {
      await request(`/projects/${projectId}/rules`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          conditions: { operator, conditions },
          action,
        }),
      });
      setShowAdd(false);
      setName('');
      setConditions([{ field: 'error.severity', op: '>=', value: 'high' }]);
      await loadRules();
    } catch (err) {
      console.error(err);
      alert('Failed to create rule');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(id: string) {
    if (!projectId) return;
    try {
      await request(`/projects/${projectId}/rules/${id}/toggle`, { method: 'POST' });
      await loadRules();
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteRule(id: string) {
    if (!projectId) return;
    if (!confirm('Delete this rule?')) return;
    try {
      await request(`/projects/${projectId}/rules/${id}`, { method: 'DELETE' });
      await loadRules();
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#e2e8f0' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ color: '#e2e8f0', marginBottom: 24 }}>Rules</h1>

      {projectId && canManage(projectId) && (
        <button onClick={() => setShowAdd(!showAdd)} style={{ marginBottom: 16 }}>
          {showAdd ? 'Cancel' : '+ Add Rule'}
        </button>
      )}

      {showAdd && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Critical errors auto-dispatch" />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Match</label>
            <select value={operator} onChange={(e) => setOperator(e.target.value as 'all' | 'any')}>
              <option value="all">All conditions</option>
              <option value="any">Any condition</option>
            </select>
          </div>

          {conditions.map((c, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select value={c.field} onChange={(e) => {
                const next = [...conditions];
                next[idx].field = e.target.value;
                setConditions(next);
              }}>
                {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={c.op} onChange={(e) => {
                const next = [...conditions];
                next[idx].op = e.target.value;
                setConditions(next);
              }}>
                {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input type="text" value={c.value} onChange={(e) => {
                const next = [...conditions];
                next[idx].value = e.target.value;
                setConditions(next);
              }} style={{ width: 100 }} />
              <button className="danger" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}>×</button>
            </div>
          ))}
          <button className="secondary" onClick={() => setConditions([...conditions, { field: 'error.severity', op: '>=', value: 'high' }])}>+ Condition</button>

          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#64748b', fontSize: 12, marginBottom: 4 }}>Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <button onClick={createRule} disabled={saving}>{saving ? 'Saving...' : 'Save Rule'}</button>
        </div>
      )}

      {rules.length === 0 ? (
        <p style={{ color: '#64748b' }}>No rules configured.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rules.map((r) => (
            <div key={r.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {r.is_active ? 'Active' : 'Inactive'} · {r.action} · {r.conditions?.operator ?? 'all'} ({r.conditions?.conditions?.length ?? 0} conditions)
                  </div>
                </div>
                {projectId && canManage(projectId) && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="secondary" onClick={() => toggleRule(r.id)}>{r.is_active ? 'Pause' : 'Activate'}</button>
                    <button className="danger" onClick={() => deleteRule(r.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
