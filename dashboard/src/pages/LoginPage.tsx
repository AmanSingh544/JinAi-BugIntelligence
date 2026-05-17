import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, AlertCircle, ArrowRight, Sun, Moon } from 'lucide-react';
import { api } from '../api';
import { JinniLogo } from '../components/JinniLogo';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export default function LoginPage() {
  const nav = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const fn = mode === 'login' ? api.auth.login : api.auth.register;
      const res = await fn(email, password);
      localStorage.setItem('token', res.token);
      await refresh();
      nav(res.needsOnboarding ? '/onboarding' : '/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputBase = [
    'w-full h-11 pt-4 pb-1 px-4 rounded-xl text-sm',
    'input-th border',
    'focus:outline-none transition-all duration-150',
    '[&:-webkit-autofill]:![background-color:var(--th-input-bg)]',
    '[&:-webkit-autofill]:![-webkit-text-fill-color:var(--th-input-text)]',
    '[&:-webkit-autofill]:![box-shadow:0_0_0_40px_var(--th-input-bg)_inset]',
  ].join(' ');

  return (
    <div className="min-h-screen bg-th-bg overflow-hidden relative flex flex-col">

      {/* ── Ambient background ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <div className="absolute top-[-15%] left-[-5%] w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.13) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-15%] right-[-5%] w-[550px] h-[550px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)' }} />
        <div className="absolute top-[35%] right-[25%] w-[350px] h-[350px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, #818cf8 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }} />
      </div>

      {/* ── Top bar ── */}
      <div className="relative z-10 flex items-center justify-between px-10 py-3 flex-shrink-0">
        <JinniLogo size={28} variant="full" />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-7 h-7 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        <button
          type="button"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          className="text-xs text-th-3 hover:text-th transition-colors duration-150"
        >
          {mode === 'login' ? 'New here?' : 'Have an account?'}
          <span className="ml-1.5 text-indigo-400 font-medium underline underline-offset-2">
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </span>
        </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 flex items-center">
        <div className="w-full max-w-5xl mx-auto px-10 flex items-center gap-12">

          {/* ── Left — editorial + genie as bg ── */}
          <motion.div
            className="lg:flex flex-col flex-1 min-w-0 relative"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            {/* Genie — faint background anchored to the right edge */}
            <img
              src="/image-1.png"
              alt=""
              aria-hidden
              className="absolute -right-10 top-1/2 -translate-y-1/2 w-72 pointer-events-none select-none"
              style={{ opacity: 0.3, filter: 'blur(1px)' }}
            />

            {/* Eyebrow badge */}
            <div className="flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] text-indigo-400 font-medium tracking-widest uppercase">AI Error Intelligence</span>
            </div>

            <h1 className="text-[32px] font-black leading-[1.07] tracking-tight text-th mb-2">
              Catch bugs<br />
              <span className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(135deg, #818cf8 0%, #c084fc 60%, #818cf8 100%)' }}>
                before users
              </span>
              <br />ever do.
            </h1>

            <p className="text-th-3 text-xs leading-relaxed max-w-sm mb-3">
              AI-powered browser observability. Every error analyzed, clustered, and dispatched — automatically.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[
                '⚡ Instant detection',
                '🧠 Claude AI analysis',
                '🔗 Auto-dispatch',
                '🗂 Semantic clustering',
              ].map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full text-[10px] text-th-2 border border-th bg-th-surface-2">
                  {t}
                </span>
              ))}
            </div>

            {/* Stats */}
            <div className="flex gap-6 mb-3">
              {[
                { value: '< 2s', label: 'detection time' },
                { value: '94%', label: 'noise reduction' },
                { value: '6×', label: 'faster triage' },
              ].map((s) => (
                <div key={s.label}>
                  <div className="text-base font-black text-th">{s.value}</div>
                  <div className="text-[10px] text-th-3">{s.label}</div>
                </div>
              ))}
            </div>

            {/* What it does list */}
            <div className="space-y-1.5 mb-3">
              {[
                'Captures every unhandled JS error + network failure',
                'Groups duplicates before they flood your inbox',
                'Writes the bug report for you — root cause included',
                'Opens the Jira / GitHub ticket automatically',
              ].map((text) => (
                <div key={text} className="flex items-start gap-2">
                  <span className="text-indigo-500 text-[10px] mt-0.5 font-bold flex-shrink-0">→</span>
                  <span className="text-[11px] text-th-3 leading-relaxed">{text}</span>
                </div>
              ))}
            </div>

            {/* Testimonial */}
            <div className="pl-3 border-l-2 border-indigo-500/40">
              <p className="text-[11px] text-th-3 italic leading-relaxed">
                "We caught a critical regression 6 hours before it hit production.
                The AI-written bug report saved us 40 minutes."
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[7px] font-bold text-white">E</div>
                <span className="text-[10px] text-th-3">Engineering Lead · Series B startup</span>
              </div>
            </div>
          </motion.div>

          {/* ── Right — form ── */}
          <motion.div
            className="w-full max-w-[350px] flex-shrink-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut', delay: 0.1 }}
          >
            {/* Mobile logo */}
            {/* <div className="mb-8 lg:hidden">
              <JinniLogo size={28} variant="full" />
            </div> */}

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <h2 className="text-[22px] font-black text-th mb-0.5 tracking-tight">
                  {mode === 'login' ? 'Welcome back.' : 'Join JinAi.'}
                </h2>
                <p className="text-xs text-th-3 mb-4">
                  {mode === 'login' ? 'Sign in to your workspace.' : 'Start catching bugs with AI.'}
                </p>
              </motion.div>
            </AnimatePresence>

            {/* OAuth */}
            <div className="space-y-2 mb-4">
              <a
                href={`${API_BASE}/auth/google`}
                className="flex items-center gap-3 h-9 px-4 rounded-xl border border-th bg-th-surface-2 text-xs text-th-2 hover:border-th-card-hov hover:bg-th-surface-3 transition-all duration-150 group"
              >
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="flex-1">Continue with Google</span>
                <ArrowRight size={13} className="text-zinc-700 group-hover:text-th-2 transition-colors" />
              </a>
              <a
                href={`${API_BASE}/auth/github`}
                className="flex items-center gap-3 h-9 px-4 rounded-xl border border-th bg-th-surface-2 text-xs text-th-2 hover:border-th-card-hov hover:bg-th-surface-3 transition-all duration-150 group"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.113.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                </svg>
                <span className="flex-1">Continue with GitHub</span>
                <ArrowRight size={13} className="text-zinc-700 group-hover:text-th-2 transition-colors" />
              </a>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-th-border-sub" />
              <span className="text-[10px] text-th-3 uppercase tracking-widest">or email</span>
              <div className="flex-1 h-px bg-th-border-sub" />
            </div>

            {/* Form */}
            <form onSubmit={(e) => void submit(e)} className="space-y-2">
              {/* Email */}
              <div className="relative">
                <label
                  className="absolute left-4 top-2 text-[10px] uppercase tracking-wider pointer-events-none transition-colors duration-150"
                  style={{ color: focused === 'email' ? 'var(--th-accent-3)' : 'var(--th-text-3)' }}
                >
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  required
                  autoComplete="email"
                  className={inputBase}
                  style={{ borderColor: focused === 'email' ? 'rgba(129,140,248,0.5)' : undefined }}
                />
              </div>

              {/* Password */}
              <div className="relative">
                <label
                  className="absolute left-4 top-2 text-[10px] uppercase tracking-wider pointer-events-none transition-colors duration-150"
                  style={{ color: focused === 'password' ? 'var(--th-accent-3)' : 'var(--th-text-3)' }}
                >
                  Password
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={`${inputBase} pr-12`}
                  style={{ borderColor: focused === 'password' ? 'rgba(129,140,248,0.5)' : undefined }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-th-3 hover:text-th-2 transition-colors"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border border-red-500/15 rounded-xl px-3 py-2.5"
                >
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {error}
                </motion.div>
              )}

              {mode === 'login' && (
                <div className="text-right">
                  <Link to="/forgot-password" className="text-xs text-th-3 hover:text-indigo-400 transition-colors duration-150">
                    Forgot password?
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="relative w-full h-9 rounded-xl text-sm font-bold text-white overflow-hidden transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed group mt-1"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
              >
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  style={{ background: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 100%)' }} />
                <span className="relative flex items-center justify-center gap-2">
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <>
                      {mode === 'login' ? 'Sign in' : 'Create account'}
                      <ArrowRight size={14} />
                    </>
                  )}
                </span>
              </button>
            </form>
          </motion.div>

        </div>
      </div>

      {/* ── Bottom footer ── */}
      <div className="relative z-10 text-center py-2 flex-shrink-0">
        <span className="text-[11px] text-th-3">© 2026 JinAi · Enterprise-grade security</span>
      </div>

    </div>
  );
}
