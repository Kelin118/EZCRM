import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import api from './api/axios.js';
import { BUSINESS_TIME_ZONE } from './utils/dateTime.js';
import { ACCESS_TOKEN_KEY, canAccessPath, getStoredUser, setStoredUser } from './auth.js';
import AppLayout from './components/layout/AppLayout.jsx';
import Button from './components/ui/Button.jsx';
import Modal from './components/ui/Modal.jsx';
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage.jsx'));
const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
const CertificatesPage = lazy(() => import('./pages/CertificatesPage.jsx'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage.jsx'));
const ClientsPage = lazy(() => import('./pages/ClientsPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const DailyPaymentsPage = lazy(() => import('./pages/DailyPaymentsPage.jsx'));
const DictionariesPage = lazy(() => import('./pages/DictionariesPage.jsx'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage.jsx'));
const EmployeeSchedulePage = lazy(() => import('./pages/EmployeeSchedulePage.jsx'));
const EmployeeWorklogPage = lazy(() => import('./pages/EmployeeWorklogPage.jsx'));
const ExportPage = lazy(() => import('./pages/ExportPage.jsx'));
const FinancePage = lazy(() => import('./pages/FinancePage.jsx'));
const LessonAttendancePage = lazy(() => import('./pages/LessonAttendancePage.jsx'));
const LeadsPage = lazy(() => import('./pages/LeadsPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const MasterClassesPage = lazy(() => import('./pages/MasterClassesPage.jsx'));
const PayrollPage = lazy(() => import('./pages/PayrollPage.jsx'));
const ProductsPage = lazy(() => import('./pages/ProductsPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'));
const PublicCertificatePage = lazy(() => import('./pages/PublicCertificatePage.jsx'));
const SchedulePage = lazy(() => import('./pages/SchedulePage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage.jsx'));
const TasksPage = lazy(() => import('./pages/TasksPage.jsx'));
const TrialsPage = lazy(() => import('./pages/TrialsPage.jsx'));
const VisitsPage = lazy(() => import('./pages/VisitsPage.jsx'));

function ProtectedRoute() {
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(ACCESS_TOKEN_KEY)) && !getStoredUser());
  const [authError, setAuthError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(ACCESS_TOKEN_KEY) || user) return;

    let mounted = true;
    setLoading(true);
    setAuthError(false);
    api
      .get('auth/me/')
      .then(({ data }) => {
        if (!mounted) return;
        setStoredUser(data);
        setUser(data);
      })
      .catch(() => {
        if (mounted) setAuthError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user, retry]);

  if (!localStorage.getItem(ACCESS_TOKEN_KEY)) return <Navigate to="/login" replace />;
  if (loading) return <div className="grid min-h-screen place-items-center bg-app text-sm font-semibold text-slate-500">Загрузка...</div>;
  if (!user) return (
    <div className="grid min-h-screen place-items-center bg-app p-4 text-center">
      <div className="grid gap-3">
        <p role="alert" className="text-sm font-semibold text-red-700">{authError ? 'Не удалось проверить вход. Проверьте соединение.' : 'Проверяем вход...'}</p>
        <Button onClick={() => setRetry((current) => current + 1)}>Повторить</Button>
      </div>
    </div>
  );
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
                <span className="text-xs font-semibold text-slate-500">{trial.scheduled_at ? new Date(trial.scheduled_at).toLocaleString('ru-RU', { timeZone: BUSINESS_TIME_ZONE }) : 'Дата не указана'}</span>
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
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-app text-sm font-semibold text-slate-500">Загрузка раздела...</div>}>
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
        <Route path="groups" element={<Navigate to="/visits?view=groups" replace />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="lessons/:id/attendance" element={<LessonAttendancePage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="products" element={<ProductsPage />} />
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
    </Suspense>
  );
}
