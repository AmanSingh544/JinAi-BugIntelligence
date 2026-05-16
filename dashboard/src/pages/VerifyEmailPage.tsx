import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing verification token.');
      return;
    }
    api.auth.verifyEmail(token)
      .then(() => {
        setStatus('success');
        setMessage('Email verified successfully.');
      })
      .catch((err: Error) => {
        setStatus('error');
        setMessage(err.message);
      });
  }, [token]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 360, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Email Verification</h1>
        {status === 'loading' && <p>Verifying your email…</p>}
        {status === 'success' && (
          <div>
            <p style={{ color: '#34d399', marginBottom: 16 }}>{message}</p>
            <Link to="/login">→ Sign in</Link>
          </div>
        )}
        {status === 'error' && (
          <div>
            <p style={{ color: '#ef4444', marginBottom: 16 }}>{message}</p>
            <Link to="/login">← Back to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
