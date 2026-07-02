import {
  Banknote,
  CalendarClock,
  CheckSquare,
  CreditCard,
  MessageSquare,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import { money } from './pageUtils.jsx';

export default function DashboardPage() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    api.get('dashboard/stats/').then(({ data }) => setStats(data));
  }, []);

  const todayItems = [
    ['Пробники', stats.trials_today, CalendarClock, 'brand'],
    ['МК', stats.master_classes_today, Sparkles, 'accent'],
    ['Посещения', stats.visits_today, CheckSquare, 'green'],
    ['Задачи', stats.tasks_today, CheckSquare, 'brand'],
  ];

  return (
    <div className="grid gap-6">
      <section className="rounded-[24px] bg-brand p-6 text-white shadow-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Рабочий день</p>
            <h2 className="mt-2 text-3xl font-bold">Контроль продаж, занятий и оплат</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Все ключевые показатели центра собраны на одном экране.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/clients"><Button variant="accent"><Plus size={16} />Клиент</Button></Link>
            <Link to="/tasks"><Button variant="secondary"><CheckSquare size={16} />Задача</Button></Link>
            <Link to="/chat"><Button variant="secondary"><MessageSquare size={16} />Чат</Button></Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Клиенты" value={stats.clients_total} icon={Users} tone="brand" />
        <StatCard title="Активные абонементы" value={stats.active_subscriptions} icon={CreditCard} tone="green" />
        <StatCard title="Заканчиваются" value={stats.subscriptions_ending ?? stats.ending_subscriptions} icon={CalendarClock} tone="amber" />
        <StatCard title="Конверсия пробников" value={`${stats.trials_conversion || 0}%`} icon={TrendingUp} tone="accent" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
          <SectionTitle title="Сегодня" subtitle="Оперативная нагрузка команды" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {todayItems.map(([title, value, icon, tone]) => (
              <StatCard key={title} title={title} value={value} icon={icon} tone={tone} />
            ))}
          </div>
          {todayItems.every(([, value]) => !value) && <EmptyState text="На сегодня нет запланированных активностей." />}
        </section>

        <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
          <SectionTitle title="Финансы" subtitle="Доходы, расходы и баланс" />
          <div className="mt-4 grid gap-3">
            <FinanceRow label="Доход сегодня" value={money(stats.income_today)} tone="green" />
            <FinanceRow label="Доход за месяц" value={money(stats.income_month)} tone="green" />
            <FinanceRow label="Доход всего" value={money(stats.income_total)} tone="green" />
            <FinanceRow label="Расход всего" value={money(stats.expense_total)} tone="red" />
            <FinanceRow label="Баланс" value={money(stats.balance)} tone="accent" strong />
          </div>
        </section>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <StatCard title="Пробники всего" value={stats.trials_total} icon={CalendarClock} tone="brand" />
        <StatCard title="Купили абонемент" value={stats.trials_bought} icon={TrendingUp} tone="green" />
        <StatCard title="Просроченные задачи" value={stats.tasks_overdue} icon={CheckSquare} tone="red" />
      </section>
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function FinanceRow({ label, value, tone, strong }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    accent: 'bg-accent/40 text-slate-900',
  };

  return (
    <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${tones[tone] || 'bg-slate-50 text-slate-700'}`}>
      <span className="text-sm font-semibold">{label}</span>
      <span className={strong ? 'text-xl font-bold' : 'font-bold'}>{value}</span>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-medium text-slate-500">
      {text}
    </div>
  );
}
