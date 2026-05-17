import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, X, Trash2, Play, Pause, AlertCircle } from 'lucide-react';
import { request } from '../api';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/utils';

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

const ACTION_LABELS: Record<string, string> = {
  auto_dispatch: 'Auto-dispatch',
  notify: 'Notify',
  ignore: 'Ignore',
};

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
  const [error, setError] = useState('');

  useEffect(() => { if (projectId) void loadRules(); }, [projectId]);

  async function loadRules() {
    if (!projectId) return;
    setLoading(true);
    try { setRules(await request<Rule[]>(`/projects/${projectId}/rules`)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function createRule() {
    if (!projectId || !name) return;
    setSaving(true);
    try {
      await request(`/projects/${projectId}/rules`, {
        method: 'POST',
        body: JSON.stringify({ name, conditions: { operator, conditions }, action }),
      });
      setShowAdd(false);
      setName('');
      setConditions([{ field: 'error.severity', op: '>=', value: 'high' }]);
      await loadRules();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function toggleRule(id: string) {
    if (!projectId) return;
    try { await request(`/projects/${projectId}/rules/${id}/toggle`, { method: 'POST' }); await loadRules(); }
    catch { /* quiet */ }
  }

  async function deleteRule(id: string) {
    if (!projectId || !confirm('Delete this rule?')) return;
    try { await request(`/projects/${projectId}/rules/${id}`, { method: 'DELETE' }); await loadRules(); }
    catch { /* quiet */ }
  }

  const canEdit = projectId ? canManage(projectId) : false;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-th-bg px-6 pt-2 pb-1 border-th-sub flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-th">Rules</h1>
          <p className="text-xs text-th-3 mt-0.5">Automate actions based on error conditions</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? <X size={12} /> : <Plus size={12} />}
            {showAdd ? 'Cancel' : 'Add Rule'}
          </Button>
        )}
      </div>
      <div className="p-6 max-w-100% mx-auto w-full">

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 mb-4">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mb-4"
          >
            <Card>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-th-3 block mb-1.5">Rule Name</label>
                    <Input
                      placeholder="Critical errors → dispatch"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-th-3 block mb-1.5">Match</label>
                    <Select value={operator} onChange={(e) => setOperator(e.target.value as 'all' | 'any')} className="w-full">
                      <option value="all">All conditions</option>
                      <option value="any">Any condition</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-th-3 uppercase tracking-widest">Conditions</div>
                  {conditions.map((c, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select value={c.field} onChange={(e) => { const n = [...conditions]; n[idx].field = e.target.value; setConditions(n); }} className="flex-1">
                        {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </Select>
                      <Select value={c.op} onChange={(e) => { const n = [...conditions]; n[idx].op = e.target.value; setConditions(n); }} className="w-16">
                        {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Input
                        className="w-24"
                        value={c.value}
                        onChange={(e) => { const n = [...conditions]; n[idx].value = e.target.value; setConditions(n); }}
                      />
                      <Button size="sm" variant="ghost" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}>
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setConditions([...conditions, { field: 'error.severity', op: '>=', value: 'high' }])}>
                    <Plus size={12} /> Add Condition
                  </Button>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-th-3 block mb-1.5">Action</label>
                  <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-48">
                    {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
                  </Select>
                </div>

                <Button size="sm" loading={saving} onClick={() => void createRule()} disabled={!name}>
                  Save Rule
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-th-surface border border-th rounded-lg animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Shield size={18} />}
          title="No rules configured"
          description="Rules auto-dispatch, notify, or ignore bugs based on conditions you define."
          action={canEdit ? <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}><Plus size={12} /> Add first rule</Button> : undefined}
        />
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3 bg-th-surface border border-th rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', r.is_active ? 'bg-green-400' : 'bg-zinc-600')} />
                <div>
                  <div className="text-xs font-medium text-th">{r.name}</div>
                  <div className="text-[10px] text-th-3 mt-0.5">
                    {ACTION_LABELS[r.action] ?? r.action} · {r.conditions?.operator} ({r.conditions?.conditions?.length ?? 0} condition{r.conditions?.conditions?.length !== 1 ? 's' : ''})
                  </div>
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="ghost" onClick={() => void toggleRule(r.id)}>
                    {r.is_active ? <Pause size={11} /> : <Play size={11} />}
                    {r.is_active ? 'Pause' : 'Activate'}
                  </Button>
                  <Button size="xs" variant="danger" onClick={() => void deleteRule(r.id)}>
                    <Trash2 size={10} />
                  </Button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
