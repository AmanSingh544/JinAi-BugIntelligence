import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mail, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

export default function VerifyEmailBanner({ inline = false }: { inline?: boolean }) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem('verify-banner-dismissed') === '1');
  }, []);

  if (!user || user.emailVerified || dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await api.auth.resendVerification();
      setSent(true);
      setTimeout(() => {
        sessionStorage.setItem('verify-banner-dismissed', '1');
        setDismissed(true);
      }, 3000);
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  if (inline) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-amber-500/80 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
        <Mail size={11} className="flex-shrink-0" />
        <span className="hidden sm:inline">Verify your email</span>
        {sent ? (
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle2 size={10} /> Sent!
          </span>
        ) : (
          <button
            onClick={() => void handleResend()}
            disabled={sending}
            className="underline underline-offset-2 text-amber-400 hover:text-amber-300 transition-colors duration-150 disabled:opacity-50 whitespace-nowrap"
          >
            {sending ? 'Sending…' : 'Resend'}
          </button>
        )}
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="overflow-hidden"
      >
        <div className="flex items-center justify-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
          <Mail size={12} className="flex-shrink-0" />
          <span>Please verify your email to receive notifications.</span>
          {sent ? (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle2 size={11} /> Sent!
            </span>
          ) : (
            <button
              onClick={() => void handleResend()}
              disabled={sending}
              className="underline underline-offset-2 hover:text-amber-300 transition-colors duration-150 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Resend email'}
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
