import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  BrowserRouter, Routes, Route, Navigate,
  useParams, useLocation, Link, useSearchParams, useNavigate,
} from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Bug, Layers, GitBranch,
  Puzzle, Shield, Activity, Settings, LogOut,
  Search, X, ChevronRight, BarChart3, Play,
  Sun, Moon, GripVertical,
} from 'lucide-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider, useTheme } from './hooks/useTheme';
import { api } from './api';
import { cn } from './lib/utils';
import { JinniLogo } from './components/JinniLogo';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ProjectsPage from './pages/ProjectsPage';
import SessionsPage from './pages/SessionsPage';
import BugsPage from './pages/BugsPage';
import BugDetailPage from './pages/BugDetailPage';
import SettingsPage from './pages/SettingsPage';
import ReleasesPage from './pages/ReleasesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import RulesPage from './pages/RulesPage';
import SystemHealthPage from './pages/SystemHealthPage';
import OverviewPage from './pages/OverviewPage';
import ActivityFeedPage from './pages/ActivityFeedPage';
import OnboardingPage from './pages/OnboardingPage';
import ClustersPage from './pages/ClustersPage';
import NotificationBell from './components/NotificationBell';
import VerifyEmailBanner from './components/VerifyEmailBanner';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function OAuthTokenHandler() {
  const [params] = useSearchParams();
  const token = params.get('token');
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      window.location.replace('/');
    }
  }, [token]);
  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <OAuthTokenHandler />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
            <Route path="/" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
            <Route path="/projects/:projectId/overview"      element={<RequireAuth><ProjectLayout><OverviewPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/sessions"      element={<RequireAuth><ProjectLayout><SessionsPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/bugs"          element={<RequireAuth><ProjectLayout><BugsPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/bugs/:bugId"   element={<RequireAuth><ProjectLayout><BugDetailPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/settings"      element={<RequireAuth><ProjectLayout><SettingsPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/releases"      element={<RequireAuth><ProjectLayout><ReleasesPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/integrations"  element={<RequireAuth><ProjectLayout><IntegrationsPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/rules"         element={<RequireAuth><ProjectLayout><RulesPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/clusters"      element={<RequireAuth><ProjectLayout><ClustersPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/health"        element={<RequireAuth><ProjectLayout><SystemHealthPage /></ProjectLayout></RequireAuth>} />
            <Route path="/projects/:projectId/activity"      element={<RequireAuth><ProjectLayout><ActivityFeedPage /></ProjectLayout></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-7 h-7 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

const SIDEBAR_MIN = 56;
const SIDEBAR_MAX = 320;
const SIDEBAR_COLLAPSE_THRESHOLD = 100; // below this snap to icon-only
const SIDEBAR_DEFAULT = 240;

/** Tooltip rendered via portal so it escapes sidebar's overflow-x-hidden */
function SidebarTooltip({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  if (disabled) return <>{children}</>;

  function showTooltip() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
            className="fixed z-[9999] pointer-events-none -translate-y-1/2"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="bg-[var(--th-tooltip-bg)] border border-[var(--th-tooltip-border)] text-[var(--th-tooltip-text)] text-xs font-medium px-2.5 py-1.5 rounded-md shadow-lg whitespace-nowrap">
              {label}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();

  const handleLogout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* best-effort server revocation */ }
    localStorage.removeItem('token');
    window.location.href = '/login';
  }, []);

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? Number(saved) : SIDEBAR_DEFAULT;
  });

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const collapsed = sidebarWidth <= SIDEBAR_MIN;

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const raw = dragStartWidth.current + delta;
      const next = raw < SIDEBAR_COLLAPSE_THRESHOLD ? SIDEBAR_MIN : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN + 1, raw));
      setSidebarWidth(next);
    }
    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth((w) => {
        localStorage.setItem('sidebar-width', String(w));
        return w;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const navItems: NavItem[] = [
    { path: `/projects/${projectId}/overview`,     label: 'Overview',      icon: <LayoutDashboard size={15} /> },
    { path: `/projects/${projectId}/bugs`,         label: 'Bugs',          icon: <Bug size={15} /> },
    { path: `/projects/${projectId}/sessions`,     label: 'Sessions',      icon: <Play size={15} /> },
    { path: `/projects/${projectId}/clusters`,     label: 'Clusters',      icon: <Layers size={15} /> },
    { path: `/projects/${projectId}/releases`,     label: 'Releases',      icon: <GitBranch size={15} /> },
    { path: `/projects/${projectId}/integrations`, label: 'Integrations',  icon: <Puzzle size={15} /> },
    { path: `/projects/${projectId}/rules`,        label: 'Rules',         icon: <Shield size={15} /> },
    { path: `/projects/${projectId}/health`,       label: 'Health',        icon: <Activity size={15} /> },
    { path: `/projects/${projectId}/activity`,     label: 'Activity',      icon: <BarChart3 size={15} /> },
    { path: `/projects/${projectId}/settings`,     label: 'Settings',      icon: <Settings size={15} /> },
  ];

  const allCmds = [
    ...navItems.map((n) => ({ label: n.label, action: () => nav(n.path), icon: n.icon, group: 'Navigate' })),
    { label: 'All Projects', action: () => nav('/'), icon: <ChevronRight size={14} />, group: 'Navigate' },
    { label: 'Sign out', action: handleLogout, icon: <LogOut size={14} />, group: 'Account' },
  ];

  const filteredCmds = cmdQuery
    ? allCmds.filter((c) => c.label.toLowerCase().includes(cmdQuery.toLowerCase()))
    : allCmds;

  const groupedCmds = filteredCmds.reduce<Record<string, typeof filteredCmds>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {});

  const openCmd = useCallback(() => { setCmdOpen(true); setCmdQuery(''); }, []);
  const closeCmd = useCallback(() => { setCmdOpen(false); setCmdQuery(''); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setCmdQuery('');
      }
      if (e.key === 'Escape') closeCmd();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeCmd]);

  const initials = user?.email ? user.email[0].toUpperCase() : '?';
  const pageName = navItems.find((n) =>
    location.pathname === n.path ||
    (n.label === 'Bugs' && location.pathname.startsWith(`/projects/${projectId}/bugs`))
  )?.label ?? '';

  return (
    <div className="flex h-screen bg-th-bg text-th overflow-hidden">

      {/* ── Sidebar ── */}
      <aside
        className="flex-shrink-0 flex flex-col border-r border-th-sub bg-th-sidebar overflow-x-hidden relative"
        style={{ width: sidebarWidth }}
      >

        {/* Logo */}
        <div className={cn(
          'flex items-center h-[56px] border-b border-th-sub flex-shrink-0',
          collapsed ? 'justify-center' : 'px-3'
        )}>
          <AnimatePresence mode="wait">
            {!collapsed ? (
              <motion.div
                key="full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-w-0"
              >
                <JinniLogo size={28} variant="full" />
              </motion.div>
            ) : (
              <motion.div
                key="icon"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden flex items-center justify-center"
                style={{ width: 32, height: 32 }}
              >
                <JinniLogo size={18} variant="icon" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Search — fixed height so it never reflows when collapsing */}
        <div className="h-[52px] flex items-center border-b border-th-sub flex-shrink-0 px-3">
          {collapsed ? (
            <SidebarTooltip label="Search  ⌘K">
              <button
                onClick={openCmd}
                className="w-9 h-9 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
              >
                <Search size={14} />
              </button>
            </SidebarTooltip>
          ) : (
            <button
              onClick={openCmd}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-th-surface-2 border border-th text-th-3 text-xs hover:border-th-card-hov hover:text-th-2 transition-colors duration-150 group"
            >
              <Search size={12} />
              <span className="flex-1 text-left truncate">Search...</span>
              <kbd className="text-[9px] font-mono kbd-th px-1.5 py-0.5 rounded hidden group-hover:block flex-shrink-0">⌘K</kbd>
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className={cn('flex-1 py-3 overflow-y-auto', collapsed ? 'px-1.5' : 'px-2')}>
          <div className="space-y-0.5">
            {navItems.map((item, i) => {
              const active = location.pathname === item.path ||
                (item.label === 'Bugs' && location.pathname.startsWith(`/projects/${projectId}/bugs`));

              const linkContent = (
                <Link
                  to={item.path}
                  className={cn(
                    'flex items-center rounded-md text-[13px] font-medium transition-all duration-150',
                    collapsed
                      ? 'justify-center w-9 h-9 mx-auto'
                      : 'gap-3 px-3 py-2',
                    active
                      ? 'bg-th-surface-3 text-th'
                      : 'text-th-3 hover:text-th-2 hover:bg-th-surface-2'
                  )}
                >
                  <span className={cn(
                    'flex-shrink-0 transition-colors duration-150',
                    active ? 'text-th-accent-3' : 'text-th-3'
                  )}>
                    {item.icon}
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.badge && (
                    <span className="ml-auto text-[10px] font-semibold bg-[var(--th-accent)]/20 text-th-accent-3 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );

              return (
                <motion.div
                  key={item.path}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25, ease: 'easeOut' }}
                >
                  <SidebarTooltip label={item.label} disabled={!collapsed}>
                    {linkContent}
                  </SidebarTooltip>
                </motion.div>
              );
            })}
          </div>
        </nav>

        {/* Bottom — user + projects link */}
        <div className={cn(
          'border-t border-th-sub flex-shrink-0',
          collapsed ? 'p-1.5 flex flex-col items-center gap-1' : 'p-3'
        )}>
          {collapsed ? (
            <SidebarTooltip label="All Projects">
              <Link
                to="/"
                className="w-9 h-9 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
              >
                <ChevronRight size={13} className="rotate-180" />
              </Link>
            </SidebarTooltip>
          ) : (
            <Link
              to="/"
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150"
            >
              <ChevronRight size={12} className="rotate-180" />
              <span className="truncate">All Projects</span>
            </Link>
          )}
        </div>

        {/* ── Drag handle — sits on the right border, always visible ── */}
        <div
          onMouseDown={startDrag}
          title="Drag to resize sidebar"
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 cursor-col-resize group"
        >
          <div className="flex items-center justify-center w-4 h-8 rounded-full bg-th-surface border border-th-border text-th-3 group-hover:text-th-accent-3 group-hover:border-th-accent-3 group-hover:bg-th-surface-2 transition-all duration-150 shadow-sm">
            <GripVertical size={10} />
          </div>
        </div>
      </aside>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header bar */}
        <header className="h-[56px] flex-shrink-0 flex items-center justify-between px-6 border-b border-th-sub bg-th-header">
          {/* Page breadcrumb / title */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-th-3 text-xs">Projects</span>
            <ChevronRight size={12} className="text-th-3" />
            <span className="text-th-2 text-xs font-medium">{pageName}</span>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <VerifyEmailBanner inline />
            <ThemeToggle />
            <NotificationBell />
            <div className="w-px h-4 bg-th-border mx-1" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[var(--th-accent)]/20 border border-[var(--th-accent)]/30 flex items-center justify-center text-[10px] font-bold text-th-accent-3 flex-shrink-0" title={user?.email ?? 'User'}>
                {initials}
              </div>
              <span className="text-xs text-th-3 max-w-[140px] truncate hidden sm:block">{user?.email ?? 'User'}</span>
              <button
                onClick={handleLogout}
                className="w-7 h-7 flex items-center justify-center rounded-md text-th-3 hover:text-th-2 hover:bg-th-surface-2 transition-colors duration-150 cursor-pointer"
                title="Sign out"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* ── Command Palette ── */}
      <AnimatePresence>
        {cmdOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closeCmd}
            />
            <motion.div
              className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 px-4"
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <div className="bg-th-surface border border-th rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-th">
                  <Search size={14} className="text-th-3 flex-shrink-0" />
                  <input
                    autoFocus
                    value={cmdQuery}
                    onChange={(e) => setCmdQuery(e.target.value)}
                    placeholder="Search commands..."
                    className="flex-1 bg-transparent text-sm text-th placeholder:text-th-3 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filteredCmds.length > 0) {
                        filteredCmds[0].action();
                        closeCmd();
                      }
                    }}
                  />
                  <button onClick={closeCmd} className="text-th-3 hover:text-th-2 transition-colors duration-150">
                    <X size={14} />
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto py-1.5">
                  {Object.entries(groupedCmds).map(([group, cmds]) => (
                    <div key={group} className="mb-1">
                      <div className="px-4 py-1.5 text-[10px] font-semibold text-th-3 uppercase tracking-widest">
                        {group}
                      </div>
                      {cmds.map((cmd, i) => (
                        <button
                          key={i}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-th-2 hover:bg-th-surface-2 hover:text-th transition-colors duration-100 text-left"
                          onClick={() => { cmd.action(); closeCmd(); }}
                        >
                          <span className="text-th-3 flex-shrink-0">{cmd.icon}</span>
                          {cmd.label}
                        </button>
                      ))}
                    </div>
                  ))}
                  {filteredCmds.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-th-3">
                      No commands found
                    </div>
                  )}
                </div>

                <div className="border-t border-th px-4 py-2 flex items-center gap-4 text-[10px] text-th-3">
                  <span className="flex items-center gap-1.5"><kbd className="font-mono kbd-th px-1.5 rounded">↵</kbd> select</span>
                  <span className="flex items-center gap-1.5"><kbd className="font-mono kbd-th px-1.5 rounded">↑↓</kbd> navigate</span>
                  <span className="flex items-center gap-1.5"><kbd className="font-mono kbd-th px-1.5 rounded">esc</kbd> close</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
