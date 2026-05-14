import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, Link } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import SessionsPage from './pages/SessionsPage';
import BugsPage from './pages/BugsPage';
import BugDetailPage from './pages/BugDetailPage';
import SettingsPage from './pages/SettingsPage';
import ReleasesPage from './pages/ReleasesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import RulesPage from './pages/RulesPage';
import SystemHealthPage from './pages/SystemHealthPage';
import NotificationBell from './components/NotificationBell';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/sessions" element={<RequireAuth><ProjectLayout><SessionsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/bugs" element={<RequireAuth><ProjectLayout><BugsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/bugs/:bugId" element={<RequireAuth><ProjectLayout><BugDetailPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/settings" element={<RequireAuth><ProjectLayout><SettingsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/releases" element={<RequireAuth><ProjectLayout><ReleasesPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/integrations" element={<RequireAuth><ProjectLayout><IntegrationsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/rules" element={<RequireAuth><ProjectLayout><RulesPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/health" element={<RequireAuth><ProjectLayout><SystemHealthPage /></ProjectLayout></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  const tabs = [
    { path: `/projects/${projectId}/sessions`, label: 'Sessions' },
    { path: `/projects/${projectId}/bugs`, label: 'Bugs' },
    { path: `/projects/${projectId}/releases`, label: 'Releases' },
    { path: `/projects/${projectId}/integrations`, label: 'Integrations' },
    { path: `/projects/${projectId}/rules`, label: 'Rules' },
    { path: `/projects/${projectId}/health`, label: 'Health' },
    { path: `/projects/${projectId}/settings`, label: 'Settings' },
  ];

  return (
    <div>
      <nav style={{ display: 'flex', gap: 4, padding: '12px 24px', borderBottom: '1px solid #2d3148', background: '#0f1117' }}>
        {tabs.map((tab) => {
          const active = location.pathname.startsWith(tab.path);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                textDecoration: 'none',
                color: active ? '#e2e8f0' : '#64748b',
                background: active ? '#1a1d27' : 'transparent',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
        <div style={{ flex: 1 }} />
        <NotificationBell />
        <button
          onClick={() => {
            localStorage.removeItem('token');
            window.location.href = '/login';
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            background: 'transparent',
            border: '1px solid #2d3148',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Logout
        </button>
      </nav>
      <main>{children}</main>
    </div>
  );
}
