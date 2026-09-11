import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import api from './api/axios.js';
import { ACCESS_TOKEN_KEY, canAccessPath, getStoredUser, setStoredUser } from './auth.js';
import AppLayout from './components/layout/AppLayout.jsx';
import Button from './components/ui/Button.jsx';
import Modal from './components/ui/Modal.jsx';
import AuditLogsPage from './pages/AuditLogsPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import CertificatesPage from './pages/CertificatesPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DailyPaymentsPage from './pages/DailyPaymentsPage.jsx';
import DictionariesPage from './pages/DictionariesPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import EmployeeSchedulePage from './pages/EmployeeSchedulePage.jsx';
import EmployeeWorklogPage from './pages/EmployeeWorklogPage.jsx';
import ExportPage from './pages/ExportPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import GroupsPage from './pages/GroupsPage.jsx';
import LessonAttendancePage from './pages/LessonAttendancePage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MasterClassesPage from './pages/MasterClassesPage.jsx';
import PayrollPage from './pages/PayrollPage.jsx';
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

  return (
    <>
      <AppLayout />
      {user && <UnprocessedTrialsModal />}
    </>
  );
}

function PublicRoute({ children }) {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ? <Navigate to="/" replace /> : children;
}

function UnprocessedTrialsModal() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState({ count: 0, results: [] });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = 'ezcrm:unprocessed-trials-shown';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    let mounted = true;
    api.get('trials/unprocessed/')
      .then(({ data }) => {
        if (!mounted || !Number(data.count || 0)) return;
        setPayload({ count: data.count || 0, results: data.results || [] });
        setOpen(true);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const close = () => setOpen(false);
  const goTrials = (trialId = '') => {
    setOpen(false);
    navigate(trialId ? `/trials?trial=${trialId}` : '/trials');
  };

  return (
    <Modal
      title="Неразобранные пробники"
      open={open}
      onClose={close}
      footer={<><Button variant="secondary" onClick={close}>Закрыть</Button><Button onClick={() => goTrials()}>К пробникам</Button></>}
    >
      <div className="grid gap-3">
        <p className="text-sm font-semibold text-slate-600">Просроченных пробников: <span className="text-slate-900">{payload.count}</span></p>
        <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 scrollbar-thin">
          {payload.results.map((trial) => (
            <button
              key={trial.id}
              type="button"
              onClick={() => goTrials(trial.id)}
              className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm transition hover:border-brand/30 hover:bg-brand/5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <span className="font-bold text-slate-900">{trial.client_name || `Пробник #${trial.id}`}</span>
                <span className="text-xs font-semibold text-slate-500">{trial.scheduled_at ? new Date(trial.scheduled_at).toLocaleString('ru-RU') : 'Дата не указана'}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">{[trial.branch_name, trial.manager_name, trial.teacher_name].filter(Boolean).join(' · ') || 'Ответственные не указаны'}</p>
              {trial.notes && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{trial.notes}</p>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
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
        <Route path="leads" element={<LeadsPage />} />
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
        <Route path="daily-payments" element={<DailyPaymentsPage />} />
        <Route path="employee-schedule" element={<EmployeeSchedulePage />} />
        <Route path="employee-worklog" element={<EmployeeWorklogPage />} />
        <Route path="payroll" element={<PayrollPage />} />
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
