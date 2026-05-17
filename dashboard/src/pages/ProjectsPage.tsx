import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderOpen, Copy, Check, ChevronRight, AlertCircle, X, Sun, Moon } from 'lucide-react';
import { JinniLogo } from '../components/JinniLogo';
import { api, type Project } from '../api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { formatDate } from '../lib/utils';
import { useTheme } from '../hooks/useTheme';

export default function ProjectsPage() {
  const { theme, toggleTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await api.projects.list();
      if (list.length === 0) { nav('/onboarding', { replace: true }); return; }
      setProjects(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const allowedOrigins = origins.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await api.projects.create(name, allowedOrigins);
      setNewKey(res.api_key);
      setName('');
      setOrigins('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function copyKey() {
    void navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-th-bg">
      {/* Top bar */}
      <header className="border-b border-th bg-th-sidebar">
        <div className="max-w-100% mx-auto px-6 h-14 flex items-center justify-between">
          <JinniLogo size={28} variant="full" />
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-7 h-7 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus size={13} />
              New Project
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-100% mx-auto px-6 py-10">
        {/* API Key reveal */}
        <AnimatePresence>
          {newKey && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-8 rounded-lg bg-green-500/5 border border-green-500/20 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-green-400 mb-1">Project created — save your API key</div>
                  <p className="text-xs text-th-3 mb-3">This key is shown once. Store it securely — you'll need it in your Chrome extension.</p>
                  <div className="flex items-center gap-2 bg-th-surface-2 border border-th rounded-md px-3 py-2">
                    <code className="text-xs font-mono text-cyan-400 flex-1 truncate">{newKey}</code>
                    <button
                      onClick={copyKey}
                      className="text-th-3 hover:text-th-2 transition-colors duration-150 flex-shrink-0"
                    >
                      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <button onClick={() => setNewKey('')} className="text-th-3 hover:text-th-2 transition-colors duration-150 mt-0.5">
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-th">Projects</h1>
            <p className="text-xs text-th-3 mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 mb-6">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {/* Create form modal */}
        <AnimatePresence>
          {showForm && (
            <>
              <motion.div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowForm(false)}
              />
              <motion.div
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <div className="bg-th-surface border border-th rounded-xl shadow-2xl p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-sm font-bold text-th">New Project</h2>
                      <p className="text-xs text-th-3 mt-0.5">Set up error monitoring for your app</p>
                    </div>
                    <button onClick={() => setShowForm(false)} className="text-th-3 hover:text-th-2 transition-colors duration-150">
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={(e) => void create(e)} className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-th-2 block mb-1.5">Project name</label>
                      <Input
                        placeholder="e.g. Production Dashboard"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-th-2 block mb-1.5">
                        Allowed origins <span className="text-th-3">(optional)</span>
                      </label>
                      <Input
                        placeholder="https://app.example.com, https://staging.example.com"
                        value={origins}
                        onChange={(e) => setOrigins(e.target.value)}
                      />
                      <p className="text-[11px] text-th-3 mt-1.5">Comma-separated. Leave empty to allow all origins.</p>
                    </div>
                    {error && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                        <AlertCircle size={12} /> {error}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button variant="secondary" type="button" onClick={() => setShowForm(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button type="submit" loading={creating} className="flex-1">
                        Create Project
                      </Button>
                    </div>
                  </form>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Projects grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-th-surface border border-th rounded-lg p-5 animate-pulse">
                <div className="h-4 w-2/3 bg-th-surface-2 rounded mb-2" />
                <div className="h-3 w-1/3 bg-th-surface-2 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
          >
            {projects.map((p) => (
              <motion.div
                key={p.id}
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              >
                <Link
                  to={`/projects/${p.id}/overview`}
                  className="group block bg-th-surface border border-th rounded-lg p-5 hover:border-th-card-hov hover:bg-th-surface-2 transition-all duration-150"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                      <FolderOpen size={14} className="text-indigo-400" />
                    </div>
                    <ChevronRight size={14} className="text-th-3 group-hover:text-th-2 transition-colors duration-150 mt-0.5" />
                  </div>
                  <div className="font-semibold text-th text-sm mb-1 truncate">{p.name}</div>
                  <div className="text-[11px] text-th-3">Created {formatDate(p.created_at)}</div>
                </Link>
              </motion.div>
            ))}

            {/* New project card */}
            <motion.div
              variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
            >
              <button
                onClick={() => setShowForm(true)}
                className="w-full h-full min-h-[112px] border border-dashed border-th rounded-lg flex flex-col items-center justify-center gap-2 text-th-3 hover:text-th-2 hover:border-th-card-hov transition-all duration-150"
              >
                <Plus size={16} />
                <span className="text-xs">New project</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
