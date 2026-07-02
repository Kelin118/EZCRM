import { LogOut, Search, UserCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { canAccessNavItem, clearStoredAuth, getStoredUser } from '../../auth.js';
import Button from '../ui/Button.jsx';
import { navItems } from './Sidebar.jsx';

const titles = {
  '/': 'Дашборд',
  '/clients': 'Клиенты',
  '/subscriptions': 'Абонементы',
  '/visits': 'Посещения',
  '/trials': 'Пробники',
  '/master-classes': 'Мастер-классы',
  '/tasks': 'Задачи',
  '/finance': 'Финансы',
  '/reports': 'Отчёты',
  '/employees': 'Сотрудники',
  '/chat': 'Чат',
  '/settings': 'Настройки',
};

const roleLabels = {
  admin: 'Администратор',
  manager: 'Менеджер',
  teacher: 'Преподаватель',
  accountant: 'Бухгалтер',
};

export default function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const visibleNavItems = navItems.filter((item) => canAccessNavItem(item, user));

  const logout = () => {
    clearStoredAuth();
    navigate('/login');
  };

  const title = location.pathname.startsWith('/clients/') ? 'Карточка клиента' : titles[location.pathname] || 'EZCRM';

  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-app/90 px-4 py-3 backdrop-blur sm:px-5 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm font-medium text-slate-500">CRM для учебного центра</p>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-3xl lg:justify-end">
          <label className="hidden min-w-0 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm md:flex lg:max-w-md">
            <Search size={17} />
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" placeholder="Поиск по CRM" />
          </label>
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm sm:flex">
            <UserCircle size={22} className="text-brand" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-800">{user?.full_name || user?.username || 'Пользователь'}</p>
              <p className="text-xs text-slate-500">{roleLabels[user?.role] || user?.role || 'онлайн'}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={logout}>
            <LogOut size={17} />
            Выйти
          </Button>
        </div>
        <nav className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin lg:hidden">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <Button
              key={to}
              variant={location.pathname === to ? 'primary' : 'secondary'}
              className="min-w-fit"
              onClick={() => navigate(to)}
            >
              <Icon size={16} />
              {label}
            </Button>
          ))}
        </nav>
      </div>
    </header>
  );
}
