import { Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from './components/layout/AppLayout.jsx';
import ChatPage from './pages/ChatPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MasterClassesPage from './pages/MasterClassesPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import SubscriptionsPage from './pages/SubscriptionsPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import TrialsPage from './pages/TrialsPage.jsx';
import VisitsPage from './pages/VisitsPage.jsx';

function ProtectedRoute() {
  return localStorage.getItem('access') ? <AppLayout /> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  return localStorage.getItem('access') ? <Navigate to="/" replace /> : children;
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
      <Route element={<ProtectedRoute />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="visits" element={<VisitsPage />} />
        <Route path="trials" element={<TrialsPage />} />
        <Route path="master-classes" element={<MasterClassesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
