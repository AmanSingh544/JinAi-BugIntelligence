import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, Link, useSearchParams } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import VerifyEmailBanner from './components/VerifyEmailBanner';
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
    <AuthProvider>
    <BrowserRouter>
      <OAuthTokenHandler />
      <VerifyEmailBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
        <Route path="/" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/overview" element={<RequireAuth><ProjectLayout><OverviewPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/sessions" element={<RequireAuth><ProjectLayout><SessionsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/bugs" element={<RequireAuth><ProjectLayout><BugsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/bugs/:bugId" element={<RequireAuth><ProjectLayout><BugDetailPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/settings" element={<RequireAuth><ProjectLayout><SettingsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/releases" element={<RequireAuth><ProjectLayout><ReleasesPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/integrations" element={<RequireAuth><ProjectLayout><IntegrationsPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/rules" element={<RequireAuth><ProjectLayout><RulesPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/clusters" element={<RequireAuth><ProjectLayout><ClustersPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/health" element={<RequireAuth><ProjectLayout><SystemHealthPage /></ProjectLayout></RequireAuth>} />
        <Route path="/projects/:projectId/activity" element={<RequireAuth><ProjectLayout><ActivityFeedPage /></ProjectLayout></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  );
}

function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  const tabs = [
    { path: `/projects/${projectId}/overview`, label: 'Overview' },
    { path: `/projects/${projectId}/sessions`, label: 'Sessions' },
    { path: `/projects/${projectId}/bugs`, label: 'Bugs' },
    { path: `/projects/${projectId}/clusters`, label: 'Clusters' },
    { path: `/projects/${projectId}/releases`, label: 'Releases' },
    { path: `/projects/${projectId}/integrations`, label: 'Integrations' },
    { path: `/projects/${projectId}/rules`, label: 'Rules' },
    { path: `/projects/${projectId}/health`, label: 'Health' },
    { path: `/projects/${projectId}/activity`, label: 'Activity' },
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
