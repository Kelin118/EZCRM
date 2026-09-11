import {
  BarChart3,
  Banknote,
  CalendarCheck,
  CalendarDays,
  Clock3,
  ClipboardClock,
  ClipboardList,
  CreditCard,
  Download,
  Gift,
  Home,
  Inbox,
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
import { useEffect, useState } from 'react';

import api from '../../api/axios.js';
import { canAccessNavItem, getStoredUser, ROLES } from '../../auth.js';

export const navItems = [
  { group: 'Основное', to: '/', label: 'Дашборд', icon: Home },
  { group: 'Основное', to: '/clients', label: 'Клиенты', icon: Users, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Основное', to: '/subscriptions', label: 'Абонементы', icon: Ticket, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Основное', to: '/visits', label: 'Посещения', icon: ListChecks, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/leads', label: 'Обращения', icon: Inbox, roles: [ROLES.MANAGER] },
  { group: 'Продажи', to: '/trials', label: 'Пробники', icon: CalendarCheck, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/master-classes', label: 'МК', icon: Sparkles, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/certificates', label: 'Сертификаты', icon: Gift, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Продажи', to: '/tasks', label: 'Задачи', icon: ClipboardList, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Обучение', to: '/groups', label: 'Группы', icon: UsersRound, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Обучение', to: '/schedule', label: 'Расписание', icon: CalendarDays, roles: [ROLES.MANAGER, ROLES.TEACHER] },
  { group: 'Управление', to: '/finance', label: 'Финансы', icon: CreditCard, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/daily-payments', label: 'Сводка оплат', icon: BarChart3, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/employee-schedule', label: 'График сотрудников', icon: CalendarDays, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/employee-worklog', label: 'Учёт времени', icon: Clock3, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/payroll', label: 'Зарплата', icon: Banknote, roles: [ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/reports', label: 'Отчёты', icon: PieChart, roles: [ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/export', label: 'Экспорт', icon: Download, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Управление', to: '/dictionaries', label: 'Справочники', icon: Library, roles: [ROLES.MANAGER] },
  { group: 'Администрирование', to: '/employees', label: 'Сотрудники', icon: UserCog, roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { group: 'Администрирование', to: '/audit-logs', label: 'Журнал действий', icon: ClipboardClock, roles: [ROLES.ADMIN] },
  { group: 'Администрирование', to: '/settings', label: 'Настройки', icon: Settings, roles: [ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { group: 'Администрирование', to: '/chat', label: 'Чат', icon: MessageSquare, roles: [ROLES.MANAGER, ROLES.TEACHER, ROLES.ACCOUNTANT] },
];

const groupOrder = ['Основное', 'Продажи', 'Обучение', 'Управление', 'Администрирование'];

const roleLabels = {
  admin: 'Администратор',
  manager: 'Менеджер',
  teacher: 'Преподаватель',
  accountant: 'Бухгалтер',
};

export default function Sidebar({ open = false, onNavigate }) {
  const user = getStoredUser();
  const [unreadLeads, setUnreadLeads] = useState(0);
  const visibleNavItems = navItems.filter((item) => canAccessNavItem(item, user));
  const groupedItems = groupOrder
    .map((group) => ({ group, items: visibleNavItems.filter((item) => item.group === group) }))
    .filter((section) => section.items.length > 0);

  useEffect(() => {
    if (!canAccessNavItem({ roles: [ROLES.MANAGER] }, user)) return undefined;
    let mounted = true;
    const loadUnread = () => {
      api.get('leads/unread-count/')
        .then(({ data }) => { if (mounted) setUnreadLeads(Number(data.total || 0)); })
        .catch(() => { if (mounted) setUnreadLeads(0); });
    };
    loadUnread();
    const intervalId = window.setInterval(loadUnread, 30000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [user?.id]);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 h-screen w-[280px] overflow-hidden p-3 transition-transform duration-200 lg:translate-x-0 lg:p-4 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-soft">
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-sm shadow-brand/20">
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
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="grid gap-1.5">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `relative flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${
                        isActive
                          ? 'bg-brand/10 text-brand shadow-none before:absolute before:left-1 before:top-2 before:h-[calc(100%-1rem)] before:w-1 before:rounded-full before:bg-brand'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-brand'
                      }`
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
                    {to === '/leads' && unreadLeads > 0 && (
                      <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unreadLeads}</span>
                    )}
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
