import { LogOut, Menu, Search, UserCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { clearStoredAuth, getStoredUser } from '../../auth.js';
import Button from '../ui/Button.jsx';

const titles = {
  '/': 'Дашборд',
  '/clients': 'Клиенты',
  '/subscriptions': 'Абонементы',
  '/visits': 'Посещения',
  '/trials': 'Пробники',
  '/master-classes': 'Мастер-классы',
  '/tasks': 'Задачи',
  '/dictionaries': 'Справочники',
  '/export': 'Экспорт',
  '/groups': 'Группы',
  '/schedule': 'Расписание',
  '/finance': 'Финансы',
  '/reports': 'Отчёты',
  '/employees': 'Сотрудники',
  '/audit-logs': 'Журнал действий',
  '/chat': 'Чат',
  '/settings': 'Настройки',
};

const roleLabels = {
  admin: 'Администратор',
  manager: 'Менеджер',
  teacher: 'Преподаватель',
  accountant: 'Бухгалтер',
};

export default function Topbar({ onMenuClick }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();

  const logout = () => {
    clearStoredAuth();
    navigate('/login');
  };

  const title = location.pathname.startsWith('/clients/')
    ? 'Карточка клиента'
    : location.pathname.startsWith('/lessons/')
      ? 'Отметка посещений'
      : titles[location.pathname] || 'EZCRM';

  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-app/90 px-3 py-3 backdrop-blur sm:px-4 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] items-center gap-3">
        <Button variant="secondary" className="h-10 w-10 shrink-0 p-0 lg:hidden" onClick={onMenuClick} aria-label="Открыть меню">
          <Menu size={19} />
        </Button>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
          <p className="hidden text-sm font-medium text-slate-500 sm:block">CRM для учебного центра</p>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2 lg:flex-1 lg:justify-end">
          <label className="hidden min-w-0 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm md:flex lg:max-w-md">
            <Search size={17} />
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" placeholder="Поиск по CRM" />
          </label>
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm sm:flex">
            <UserCircle size={22} className="text-brand" />
            <div className="min-w-0 leading-tight">
              <p className="max-w-44 truncate text-sm font-semibold text-slate-800">{user?.full_name || user?.username || 'Пользователь'}</p>
              <p className="text-xs text-slate-500">{roleLabels[user?.role] || user?.role || 'онлайн'}</p>
            </div>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={logout}>
            <LogOut size={17} />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
