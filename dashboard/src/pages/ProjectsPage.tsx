import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      setProjects(await api.projects.list());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const allowedOrigins = origins.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await api.projects.create(name, allowedOrigins);
      setNewKey(res.api_key);
      setName('');
      setOrigins('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Projects</h1>

      {newKey && (
        <div className="card" style={{ marginBottom: 24, borderColor: '#22c55e' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#22c55e' }}>Project created — save your API key (shown once)</div>
          <code style={{ fontSize: 12, wordBreak: 'break-all', color: '#a5f3fc' }}>{newKey}</code>
          <button className="secondary" style={{ marginTop: 12, display: 'block' }} onClick={() => setNewKey('')}>
            Done
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>New Project</h2>
        <form onSubmit={(e) => void create(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="Allowed origins (comma-separated, optional)"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
          />
          {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
          <button type="submit" disabled={creating} style={{ alignSelf: 'flex-start' }}>
            {creating ? 'Creating…' : 'Create Project'}
          </button>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {projects.map((p) => (
          <div key={p.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                Created {new Date(p.created_at).toLocaleDateString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to={`/projects/${p.id}/bugs`}>
                <button className="secondary">Bugs</button>
              </Link>
              <Link to={`/projects/${p.id}/sessions`}>
                <button className="secondary">Sessions</button>
              </Link>
            </div>
          </div>
        ))}
        {projects.length === 0 && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
            No projects yet. Create one above.
          </div>
        )}
      </div>
    </div>
  );
}
