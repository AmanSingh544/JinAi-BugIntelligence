import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { JinniLogo } from '../components/JinniLogo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

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
    <div className="min-h-screen bg-th-bg flex items-center justify-center p-6">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="mb-10">
          <JinniLogo size={32} variant="full" />
        </div>

        <AnimatePresence mode="wait">
          {sent ? (
            <motion.div key="sent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
                <CheckCircle2 size={18} className="text-green-400" />
              </div>
              <h1 className="text-xl font-bold text-th mb-2">Check your email</h1>
              <p className="text-sm text-th-3 mb-6">
                If this email is registered, we've sent a reset link. Check your inbox.
              </p>
              <Link to="/login" className="flex items-center gap-2 text-xs text-th-3 hover:text-th-2 transition-colors duration-150">
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-xl font-bold text-th mb-1">Reset password</h1>
              <p className="text-sm text-th-3 mb-6">Enter your email and we'll send a reset link.</p>

              <form onSubmit={(e) => void submit(e)} className="space-y-3">
                <Input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail size={13} />}
                  required
                  autoFocus
                />
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                    <AlertCircle size={12} /> {error}
                  </div>
                )}
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  Send reset link
                </Button>
              </form>

              <div className="mt-4 text-center">
                <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-th-3 hover:text-th-2 transition-colors duration-150">
                  <ArrowLeft size={11} /> Back to sign in
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
