import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function OnboardingPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await api.projects.create(name, []);
      nav(`/projects/${res.id}/overview`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="card" style={{ width: 420 }}>
        {step === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Welcome to Bug Intelligence</h1>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              Track, analyze, and resolve frontend errors with AI-powered root-cause analysis,
              session replay, and intelligent clustering.
            </p>
            <button onClick={() => setStep(2)} style={{ width: '100%' }}>
              Get Started
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Create your first project</h1>
            <form onSubmit={(e) => void create(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
              <button type="submit" disabled={creating} style={{ width: '100%' }}>
                {creating ? 'Creating…' : 'Create Project'}
              </button>
              <button type="button" className="secondary" onClick={() => setStep(1)}>
                Back
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
