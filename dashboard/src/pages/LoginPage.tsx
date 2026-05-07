import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fn = mode === 'login' ? api.auth.login : api.auth.register;
      const res = await fn(email, password);
      localStorage.setItem('token', res.token);
      nav('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Bug Intelligence</h1>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} required
          />
          {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button" className="secondary"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create account instead' : 'Sign in instead'}
          </button>
        </form>
      </div>
    </div>
  );
}
