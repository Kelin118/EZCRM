import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';

import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function AppLayout() {
  const [forbiddenMessage, setForbiddenMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const onForbidden = (event) => {
      setForbiddenMessage(event.detail || 'Нет доступа к этому действию');
      window.clearTimeout(onForbidden.timeout);
      onForbidden.timeout = window.setTimeout(() => setForbiddenMessage(''), 3200);
    };

    window.addEventListener('api-forbidden', onForbidden);
    window.addEventListener('api-error', onForbidden);
    return () => {
      window.removeEventListener('api-forbidden', onForbidden);
      window.removeEventListener('api-error', onForbidden);
      window.clearTimeout(onForbidden.timeout);
    };
  }, []);

  useEffect(() => {
    const onSuccess = (event) => {
      setSuccessMessage(event.detail || 'Готово');
      window.clearTimeout(onSuccess.timeout);
      onSuccess.timeout = window.setTimeout(() => setSuccessMessage(''), 2600);
    };

    window.addEventListener('api-success', onSuccess);
    return () => {
      window.removeEventListener('api-success', onSuccess);
      window.clearTimeout(onSuccess.timeout);
    };
  }, []);

  return (
    <div className="min-h-screen bg-app">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          aria-label="Закрыть меню"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div className="lg:pl-[280px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        {forbiddenMessage && (
          <div className="fixed right-4 top-4 z-50 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-card">
            {forbiddenMessage}
          </div>
        )}
        {successMessage && (
          <div className="fixed right-4 top-4 z-50 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-card">
            {successMessage}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1560px] px-3 py-4 sm:px-4 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
