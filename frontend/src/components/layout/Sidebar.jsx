import {
  BarChart3,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Home,
  MessageSquare,
  PieChart,
  Settings,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Дашборд', icon: Home },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/subscriptions', label: 'Абонементы', icon: Ticket },
  { to: '/trials', label: 'Пробники', icon: CalendarCheck },
  { to: '/master-classes', label: 'МК', icon: Sparkles },
  { to: '/tasks', label: 'Задачи', icon: ClipboardList },
  { to: '/finance', label: 'Финансы', icon: CreditCard },
  { to: '/reports', label: 'Отчёты', icon: PieChart },
  { to: '/chat', label: 'Чат', icon: MessageSquare },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-100 bg-white lg:block">
      <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand text-white">
          <BarChart3 size={21} />
        </div>
        <div>
          <p className="text-base font-semibold text-slate-900">EDUCRM</p>
          <p className="text-xs text-slate-500">образовательный центр</p>
        </div>
      </div>
      <nav className="grid gap-1 p-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
