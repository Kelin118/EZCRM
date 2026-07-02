import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';

import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function AppLayout() {
  const [forbiddenMessage, setForbiddenMessage] = useState('');

  useEffect(() => {
    const onForbidden = (event) => {
      setForbiddenMessage(event.detail || 'Нет доступа к этому действию');
      window.clearTimeout(onForbidden.timeout);
      onForbidden.timeout = window.setTimeout(() => setForbiddenMessage(''), 3200);
    };

    window.addEventListener('api-forbidden', onForbidden);
    return () => {
      window.removeEventListener('api-forbidden', onForbidden);
      window.clearTimeout(onForbidden.timeout);
    };
  }, []);

  return (
    <div className="min-h-screen bg-app">
      <Sidebar />
      <div className="lg:pl-72">
        <Topbar />
        {forbiddenMessage && (
          <div className="fixed right-4 top-4 z-50 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-card">
            {forbiddenMessage}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-5 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
