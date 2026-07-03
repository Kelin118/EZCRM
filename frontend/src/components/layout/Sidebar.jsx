import {
  BarChart3,
  CalendarCheck,
  ClipboardList,
  ClipboardClock,
  CreditCard,
  Home,
  ListChecks,
  MessageSquare,
  PieChart,
  Settings,
  Sparkles,
  Ticket,
  UserCog,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { canAccessNavItem, getStoredUser, ROLES } from '../../auth.js';

export const navItems = [
  { to: '/', label: 'Дашборд', icon: Home },
  { to: '/clients', label: 'Клиенты', icon: Users, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/subscriptions', label: 'Абонементы', icon: Ticket, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/visits', label: 'Посещения', icon: ListChecks, roles: [ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/trials', label: 'Пробники', icon: CalendarCheck, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/master-classes', label: 'МК', icon: Sparkles, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/tasks', label: 'Задачи', icon: ClipboardList, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { to: '/finance', label: 'Финансы', icon: CreditCard, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { to: '/reports', label: 'Отчёты', icon: PieChart, roles: [ROLES.ACCOUNTANT] },
  { to: '/employees', label: 'Сотрудники', icon: UserCog, roles: [ROLES.ADMIN] },
  { to: '/audit-logs', label: 'Журнал действий', icon: ClipboardClock, roles: [ROLES.ADMIN] },
  { to: '/chat', label: 'Чат', icon: MessageSquare, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { to: '/settings', label: 'Настройки', icon: Settings, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
];

export default function Sidebar() {
  const user = getStoredUser();
  const visibleNavItems = navItems.filter((item) => canAccessNavItem(item, user));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 p-4 lg:block">
      <div className="flex h-full flex-col rounded-[24px] border border-white/70 bg-white shadow-soft">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-white shadow-md shadow-brand/25">
            <BarChart3 size={23} />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900">EZCRM</p>
            <p className="text-xs font-medium text-slate-500">образовательный центр</p>
          </div>
        </div>
        <nav className="grid gap-1.5 p-3">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-brand text-white shadow-md shadow-brand/20'
                    : 'text-slate-600 hover:bg-brand/5 hover:text-brand'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-2xl bg-accent/35 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">EZCRM</p>
            <p className="mt-1 text-xs leading-5">Единая рабочая зона для продаж, занятий и финансов.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
