import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import SessionsPage from './pages/SessionsPage';
import BugsPage from './pages/BugsPage';
import BugDetailPage from './pages/BugDetailPage';

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
        <Route path="/projects/:projectId/sessions" element={<RequireAuth><SessionsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/bugs" element={<RequireAuth><BugsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/bugs/:bugId" element={<RequireAuth><BugDetailPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
