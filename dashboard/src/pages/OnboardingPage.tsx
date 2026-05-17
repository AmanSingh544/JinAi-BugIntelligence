import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, AlertCircle, Copy, Check } from 'lucide-react';
import { api } from '../api';
import { JinniLogo } from '../components/JinniLogo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export default function OnboardingPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await api.projects.create(name, []);
      setApiKey(res.api_key);
      setProjectId(res.id);
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function copyKey() {
    void navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-th-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-10">
          <JinniLogo size={32} variant="full" />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <h1 className="text-2xl font-bold text-th mb-3">Welcome to JinAi</h1>
              <p className="text-sm text-th-3 leading-relaxed mb-8">
                AI-powered error monitoring for your web apps. Capture bugs, get root-cause analysis, and fix faster.
              </p>

              <div className="space-y-3 mb-8">
                {[
                  { n: '1', t: 'Create a project', d: 'Get an API key to embed in your Chrome extension.' },
                  { n: '2', t: 'Install the extension', d: 'Paste your key — errors are captured automatically.' },
                  { n: '3', t: 'Review AI analysis', d: 'See root causes, steps to reproduce, and fix suggestions.' },
                ].map((s) => (
                  <div key={s.n} className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-400 flex-shrink-0 mt-0.5">
                      {s.n}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-th">{s.t}</div>
                      <div className="text-xs text-th-3 mt-0.5">{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>

              <Button className="w-full" size="lg" onClick={() => setStep(2)}>
                Get started <ArrowRight size={14} />
              </Button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <h1 className="text-xl font-bold text-th mb-1">Create your first project</h1>
              <p className="text-sm text-th-3 mb-6">Give it a name to get started. You can add more projects later.</p>

              <form onSubmit={(e) => void create(e)} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-th-2 block mb-1.5">Project name</label>
                  <Input
                    placeholder="e.g. Production App"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                    <AlertCircle size={12} /> {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" type="button" onClick={() => setStep(1)} className="flex-1">Back</Button>
                  <Button type="submit" loading={creating} className="flex-1">Create Project</Button>
                </div>
              </form>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-4">
                <Check size={14} className="text-green-400" />
              </div>
              <h1 className="text-xl font-bold text-th mb-1">Project created!</h1>
              <p className="text-sm text-th-3 mb-6">
                Copy your API key now — it's only shown once and won't be retrievable later.
              </p>

              <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-4 mb-6">
                <div className="text-xs font-semibold text-green-400 mb-2">Your API key</div>
                <div className="flex items-center gap-2 bg-th-surface border border-th rounded-md px-3 py-2">
                  <code className="text-xs font-mono text-cyan-400 flex-1 break-all">{apiKey}</code>
                  <button
                    onClick={copyKey}
                    className="text-th-3 hover:text-th-2 transition-colors duration-150 flex-shrink-0 ml-2"
                  >
                    {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  </button>
                </div>
                <p className="text-[11px] text-th-3 mt-2">Paste this key into your Chrome extension settings.</p>
              </div>

              <Button className="w-full" size="lg" onClick={() => nav(`/projects/${projectId}/overview`)}>
                Go to dashboard <ArrowRight size={14} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
