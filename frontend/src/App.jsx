import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import api from './api/axios.js';
import { ACCESS_TOKEN_KEY, canAccessPath, getStoredUser, setStoredUser } from './auth.js';
import AppLayout from './components/layout/AppLayout.jsx';
import AuditLogsPage from './pages/AuditLogsPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import CertificatesPage from './pages/CertificatesPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DictionariesPage from './pages/DictionariesPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import ExportPage from './pages/ExportPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import GroupsPage from './pages/GroupsPage.jsx';
import LessonAttendancePage from './pages/LessonAttendancePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MasterClassesPage from './pages/MasterClassesPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import PublicCertificatePage from './pages/PublicCertificatePage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import SubscriptionsPage from './pages/SubscriptionsPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import TrialsPage from './pages/TrialsPage.jsx';
import VisitsPage from './pages/VisitsPage.jsx';

function ProtectedRoute() {
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(ACCESS_TOKEN_KEY)) && !getStoredUser());

  useEffect(() => {
    if (!localStorage.getItem(ACCESS_TOKEN_KEY) || user) return;

    let mounted = true;
    setLoading(true);
    api
      .get('auth/me/')
      .then(({ data }) => {
        if (!mounted) return;
        setStoredUser(data);
        setUser(data);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  if (!localStorage.getItem(ACCESS_TOKEN_KEY)) return <Navigate to="/login" replace />;
  if (loading) return <div className="grid min-h-screen place-items-center bg-app text-sm font-semibold text-slate-500">Загрузка...</div>;
  if (user && !canAccessPath(location.pathname, user)) return <Navigate to="/" replace />;

  return <AppLayout />;
}

function PublicRoute({ children }) {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route path="/certificate/:token" element={<PublicCertificatePage />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="visits" element={<VisitsPage />} />
        <Route path="trials" element={<TrialsPage />} />
        <Route path="master-classes" element={<MasterClassesPage />} />
        <Route path="certificates" element={<CertificatesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="dictionaries" element={<DictionariesPage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="lessons/:id/attendance" element={<LessonAttendancePage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
