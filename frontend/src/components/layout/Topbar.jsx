import { LogOut, Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import Button from '../ui/Button.jsx';

const titles = {
  '/': 'Дашборд',
  '/clients': 'Клиенты',
  '/subscriptions': 'Абонементы',
  '/trials': 'Пробники',
  '/master-classes': 'Мастер-классы',
  '/tasks': 'Задачи',
  '/finance': 'Финансы',
  '/reports': 'Отчёты',
  '/chat': 'Чат',
  '/settings': 'Настройки',
};

export default function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const logout = () => {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-100 bg-white/95 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" className="h-10 w-10 p-0 lg:hidden" aria-label="Меню">
          <Menu size={20} />
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{titles[location.pathname] || 'EDUCRM'}</h1>
          <p className="text-sm text-slate-500">CRM для учебного центра</p>
        </div>
      </div>
      <Button variant="secondary" onClick={logout}>
        <LogOut size={17} />
        Выйти
      </Button>
    </header>
  );
}
