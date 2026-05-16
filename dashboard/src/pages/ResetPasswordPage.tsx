import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) setError('Invalid or missing reset token.');
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => nav('/login'), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>New Password</h1>
        {done ? (
          <div>
            <p style={{ marginBottom: 16 }}>Password updated successfully. Redirecting to sign in…</p>
            <Link to="/login">← Sign in now</Link>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="password" placeholder="New password" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={8}
            />
            <input
              type="password" placeholder="Confirm password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required minLength={8}
            />
            {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={loading || !token}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
            <Link to="/login" style={{ fontSize: 13, textAlign: 'center' }}>
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
