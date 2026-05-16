import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

export default function VerifyEmailBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem('verify-banner-dismissed') === '1');
  }, []);

  if (!user || user.emailVerified || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem('verify-banner-dismissed', '1');
    setDismissed(true);
  };

  const handleResend = async () => {
    setSending(true);
    try {
      await api.auth.resendVerification();
      setSent(true);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(251, 191, 36, 0.1)',
      borderBottom: '1px solid rgba(251, 191, 36, 0.3)',
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      fontSize: 13,
      color: '#fbbf24',
    }}>
      <span>Please verify your email address to ensure you receive notifications.</span>
      {sent ? (
        <span style={{ color: '#34d399' }}>Email sent!</span>
      ) : (
        <button
          onClick={handleResend}
          disabled={sending}
          style={{
            background: 'transparent',
            border: '1px solid #fbbf24',
            color: '#fbbf24',
            padding: '4px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {sending ? 'Sending…' : 'Resend email'}
        </button>
      )}
      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          cursor: 'pointer',
          fontSize: 12,
          marginLeft: 8,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
