import {
  Banknote,
  Building2,
  CalendarClock,
  CheckSquare,
  CreditCard,
  Layers,
  Percent,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import { getStoredUser, hasRole, ROLES } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import { Filters, Input, money, PageHeader, SelectField } from './pageUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import { useBranchFilter } from '../contexts/BranchFilterContext.jsx';
import { normalizeDateForInput } from '../utils/dateTime.js';

function isoDate(date) {
  return normalizeDateForInput(date);
}

function period(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days + 1);
  return { date_from: isoDate(from), date_to: isoDate(to) };
}

function thisMonth() {
  const now = new Date();
  return { date_from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), date_to: isoDate(now) };
}

export default function DashboardPage() {
  const user = getStoredUser();
  const canViewFinance = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT]);
  const { selectedBranch, setSelectedBranch } = useBranchFilter();
  const [filters, setFilters] = useState(() => ({ ...period(30), branch: selectedBranch }));
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...period(30), branch: selectedBranch }));
  const { branches, branchFilterOptions, loading: branchesLoading } = useBranches();
  const [stats, setStats] = useState({});

  useEffect(() => {
    api.get('dashboard/stats/', { params: appliedFilters }).then(({ data }) => setStats(data));
  }, [appliedFilters]);

  useEffect(() => {
    if (branchesLoading || selectedBranch === 'all' || selectedBranch === 'unassigned') return;
    if (!branches.some((branch) => String(branch.id) === selectedBranch)) {
      setSelectedBranch('all');
      setFilters((current) => ({ ...current, branch: 'all' }));
      setAppliedFilters((current) => ({ ...current, branch: 'all' }));
    }
  }, [branches, branchesLoading, selectedBranch, setSelectedBranch]);

  const changeBranch = (value) => {
    setSelectedBranch(value);
    setFilters((current) => ({ ...current, branch: value }));
    setAppliedFilters((current) => ({ ...current, branch: value }));
  };

  const finance = stats.finance || {};
  const subscriptions = stats.subscriptions || {};
  const groups = stats.groups || {};
  const lessons = stats.lessons || {};
  const attendance = stats.attendance || {};
  const trials = stats.trials || {};
  const masterClasses = stats.master_classes || {};
  const tasks = stats.tasks || {};

  const cards = [
    canViewFinance && { title: 'Доход', value: money(finance.income), icon: Banknote, tone: 'green' },
    canViewFinance && { title: 'Расход', value: money(finance.expense), icon: TrendingDown, tone: 'red' },
    canViewFinance && { title: 'Баланс', value: money(finance.balance), icon: CreditCard, tone: 'accent' },
    { title: 'Активные абонементы', value: subscriptions.active, icon: CreditCard, tone: 'green' },
    { title: 'Заканчиваются', value: subscriptions.ending_soon, icon: CalendarClock, tone: 'amber' },
    { title: 'Активные группы', value: groups.active, icon: Users, tone: 'brand' },
    { title: 'Уроков проведено', value: lessons.completed, icon: CheckSquare, tone: 'green' },
    { title: 'Посещаемость', value: `${attendance.attendance_rate || 0}%`, icon: Percent, tone: 'accent' },
    { title: 'Пробники', value: trials.total, icon: CalendarClock, tone: 'brand' },
    { title: 'Конверсия пробников', value: `${trials.conversion || 0}%`, icon: TrendingUp, tone: 'green' },
    { title: 'МК', value: masterClasses.total, icon: Sparkles, tone: 'brand' },
    { title: 'Конверсия МК', value: `${masterClasses.conversion || 0}%`, icon: TrendingUp, tone: 'green' },
    { title: 'Задачи просрочены', value: tasks.overdue, icon: CheckSquare, tone: 'red' },
  ].filter(Boolean);

  return (
    <div className="grid gap-6">
      <PageHeader title="Дашборд">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { const value = period(1); setFilters(value); setAppliedFilters(value); }}>Сегодня</Button>
          <Button variant="secondary" onClick={() => { const value = period(7); setFilters(value); setAppliedFilters(value); }}>7 дней</Button>
          <Button variant="secondary" onClick={() => { const value = period(30); setFilters(value); setAppliedFilters(value); }}>30 дней</Button>
          <Button variant="secondary" onClick={() => { const value = thisMonth(); setFilters(value); setAppliedFilters(value); }}>Этот месяц</Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3 rounded-[24px] border border-brand/10 bg-white p-4 shadow-card">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/10 text-brand"><Building2 size={21} /></div>
        <div className="min-w-[240px] flex-1 sm:max-w-sm">
          <SelectField label="Данные филиала" value={selectedBranch} onChange={changeBranch} options={branchFilterOptions} />
        </div>
      </div>

      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <SelectField label="Филиал" value={filters.branch || 'all'} onChange={(value) => setFilters({ ...filters, branch: value })} options={branchFilterOptions} />
        <div className="flex items-end">
          <Button onClick={() => setAppliedFilters(filters)}>Применить</Button>
        </div>
      </Filters>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <StatCard key={card.title} {...card} />)}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <MiniPanel title="Группы" icon={Layers} rows={[
          ['Всего', groups.total],
          ['Активные', groups.active],
          ['На паузе', groups.paused],
          ['Ученики', groups.students_total],
        ]} />
        <MiniPanel title="Уроки" icon={CalendarClock} rows={[
          ['Запланированы', lessons.planned],
          ['Проведены', lessons.completed],
          ['Отменены', lessons.cancelled],
          ['Всего', lessons.total],
        ]} />
        <MiniPanel title="Посещения" icon={CheckSquare} rows={[
          ['Пришли', attendance.attended],
          ['Пропустили', attendance.missed],
          ['Отработки', attendance.makeup],
          ['Всего отметок', attendance.total_visits],
        ]} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">Сводка по филиалам</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(stats.branches_summary || []).map((branch) => (
            <div key={branch.key} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Building2 size={18} className="text-brand" />{branch.name}</div>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                <span>Клиенты: <b>{branch.clients}</b></span><span>Абонементы: <b>{branch.subscriptions}</b></span>
                <span>Доход: <b>{money(branch.income)}</b></span><span>Занятия: <b>{branch.lessons}</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MiniPanel({ title, rows, icon: Icon }) {
  return (
    <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand/10 text-brand">
          <Icon size={18} />
        </div>
        <h3 className="font-bold text-slate-900">{title}</h3>
      </div>
      <div className="grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <span className="font-semibold text-slate-500">{label}</span>
            <span className="font-bold text-slate-900">{value ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
