import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, ArrowLeft, Lock } from 'lucide-react';
import { api } from '../api';
import { JinniLogo } from '../components/JinniLogo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

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
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
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

        <div className="bg-th-surface border border-th rounded-xl p-8">
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={20} className="text-green-400" />
                </div>
                <h2 className="text-base font-bold text-th mb-1">Password updated</h2>
                <p className="text-sm text-th-3 mb-6">Redirecting you to sign in…</p>
                <Link to="/login" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors duration-150">
                  Sign in now →
                </Link>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex items-center gap-2 mb-1">
                  <Lock size={14} className="text-th-3" />
                  <h2 className="text-base font-bold text-th">New password</h2>
                </div>
                <p className="text-xs text-th-3 mb-6">Choose a strong password of at least 8 characters.</p>

                <form onSubmit={(e) => void submit(e)} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-th-3 uppercase tracking-wider mb-1.5">New Password</label>
                    <Input
                      type="password"
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-th-3 uppercase tracking-wider mb-1.5">Confirm Password</label>
                    <Input
                      type="password"
                      placeholder="Repeat password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
                      >
                        <AlertCircle size={12} />
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button type="submit" className="w-full" loading={loading} disabled={!token}>
                    Update password
                  </Button>
                </form>

                <div className="mt-5 pt-4 border-t border-th flex justify-center">
                  <Link to="/login" className="flex items-center gap-1.5 text-xs text-th-3 hover:text-th-2 transition-colors duration-150">
                    <ArrowLeft size={12} /> Back to sign in
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
