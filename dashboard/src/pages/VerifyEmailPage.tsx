import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { JinniLogo } from '../components/JinniLogo';
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
        setMessage('Your email has been verified successfully.');
      })
      .catch((err: Error) => {
        setStatus('error');
        setMessage(err.message);
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-th-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <JinniLogo size={32} variant="full" />
        </div>

        <div className="bg-th-surface border border-th rounded-xl p-8 text-center">
          {status === 'loading' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="w-12 h-12 rounded-full bg-th-surface-2 border border-th flex items-center justify-center mx-auto mb-4">
                <Loader2 size={20} className="text-th-2 animate-spin" />
              </div>
              <h2 className="text-base font-bold text-th mb-1">Verifying your email</h2>
              <p className="text-xs text-th-3">Just a moment…</p>
            </motion.div>
          )}

          {status === 'success' && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={20} className="text-green-400" />
              </div>
              <h2 className="text-base font-bold text-th mb-1">Email verified</h2>
              <p className="text-xs text-th-3 mb-6">{message}</p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors duration-150"
              >
                Sign in to your account <ArrowRight size={12} />
              </Link>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={20} className="text-red-400" />
              </div>
              <h2 className="text-base font-bold text-th mb-1">Verification failed</h2>
              <p className="text-xs text-th-3 mb-6">{message}</p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-xs text-th-3 hover:text-th-2 transition-colors duration-150"
              >
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
