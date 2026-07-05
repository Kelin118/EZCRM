import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ClipboardClock,
  ClipboardList,
  CreditCard,
  Download,
  Home,
  Library,
  ListChecks,
  MessageSquare,
  PieChart,
  Settings,
  Sparkles,
  Ticket,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { canAccessNavItem, getStoredUser, ROLES } from '../../auth.js';

export const navItems = [
  { group: 'Основное', to: '/', label: 'Дашборд', icon: Home },
  { group: 'Основное', to: '/clients', label: 'Клиенты', icon: Users, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Основное', to: '/subscriptions', label: 'Абонементы', icon: Ticket, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Основное', to: '/visits', label: 'Посещения', icon: ListChecks, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/trials', label: 'Пробники', icon: CalendarCheck, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/master-classes', label: 'МК', icon: Sparkles, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/tasks', label: 'Задачи', icon: ClipboardList, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Обучение', to: '/groups', label: 'Группы', icon: UsersRound, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Обучение', to: '/schedule', label: 'Расписание', icon: CalendarDays, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Управление', to: '/finance', label: 'Финансы', icon: CreditCard, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/reports', label: 'Отчёты', icon: PieChart, roles: [ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/export', label: 'Экспорт', icon: Download, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/dictionaries', label: 'Справочники', icon: Library, roles: [ROLES.MANAGER] },
  { group: 'Администрирование', to: '/employees', label: 'Сотрудники', icon: UserCog, roles: [ROLES.ADMIN] },
  { group: 'Администрирование', to: '/audit-logs', label: 'Журнал действий', icon: ClipboardClock, roles: [ROLES.ADMIN] },
  { group: 'Администрирование', to: '/settings', label: 'Настройки', icon: Settings, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Администрирование', to: '/chat', label: 'Чат', icon: MessageSquare, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
];

const groupOrder = ['Основное', 'Продажи', 'Обучение', 'Управление', 'Администрирование'];

export default function Sidebar({ open = false, onNavigate }) {
  const user = getStoredUser();
  const visibleNavItems = navItems.filter((item) => canAccessNavItem(item, user));
  const groupedItems = groupOrder
    .map((group) => ({ group, items: visibleNavItems.filter((item) => item.group === group) }))
    .filter((section) => section.items.length > 0);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 h-screen w-[280px] overflow-hidden p-3 transition-transform duration-200 lg:translate-x-0 lg:p-4 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-soft">
        <div className="shrink-0 border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-md shadow-brand/25">
              <BarChart3 size={23} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-slate-900">EZCRM</p>
              <p className="truncate text-xs font-medium text-slate-500">образовательный центр</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 scrollbar-thin">
          {groupedItems.map(({ group, items }) => (
            <div key={group} className="mb-4 last:mb-0">
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="grid gap-1.5">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition ${
                        isActive
                          ? 'bg-brand text-white shadow-md shadow-brand/20'
                          : 'text-slate-600 hover:bg-brand/5 hover:text-brand'
                      }`
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-100 p-3">
          <div className="rounded-2xl bg-accent/35 p-3 text-sm text-slate-700">
            <p className="truncate font-semibold text-slate-900">EZCRM</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5">Рабочая зона для продаж, занятий и финансов.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
