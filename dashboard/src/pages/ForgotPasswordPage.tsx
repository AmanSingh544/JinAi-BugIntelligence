import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Reset Password</h1>
        {sent ? (
          <div>
            <p style={{ marginBottom: 16 }}>If this email is registered, you will receive a reset link.</p>
            <Link to="/login">← Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email" placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} required
            />
            {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
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
