import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { BranchFilterProvider } from '../../contexts/BranchFilterContext.jsx';
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
    <BranchFilterProvider>
      <div className="min-h-screen bg-app">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand focus:shadow-card">
          Перейти к содержимому
        </a>
        {sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-sm lg:hidden"
            aria-label="Закрыть меню"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
        <div className="lg:pl-[280px]">
          <Topbar onMenuClick={() => setSidebarOpen(true)} />
          <div className="fixed right-3 top-3 z-50 grid w-[min(24rem,calc(100vw-1.5rem))] gap-2 sm:right-4 sm:top-4" role="status" aria-live="polite">
            {forbiddenMessage && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-card">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{forbiddenMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-card">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{successMessage}</span>
              </div>
            )}
          </div>
          <main id="main-content" className="mx-auto w-full max-w-[1560px] overflow-x-hidden px-3 py-4 sm:px-4 md:py-5 lg:px-8 lg:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </BranchFilterProvider>
  );
}
