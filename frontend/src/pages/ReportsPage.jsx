import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import { Filters, Input, PageHeader, SelectField, Table, dateOnly, money } from './pageUtils.jsx';
import useBranches from '../hooks/useBranches.js';

function isoDate(date) {
  return date.toISOString().slice(0, 10);
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

function percent(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')}%`;
}

export default function ReportsPage() {
  const [filters, setFilters] = useState(period(30));
  const [appliedFilters, setAppliedFilters] = useState(period(30));
  const { branchOptions } = useBranches();
  const [summary, setSummary] = useState({});

  useEffect(() => {
    api.get('reports/summary/', { params: appliedFilters }).then(({ data }) => setSummary(data));
  }, [appliedFilters]);

  const dailyFinance = summary.daily_finance || [];
  const sourceData = summary.income_by_source || [];
  const groupAttendance = summary.attendance_by_group || [];

  return (
    <div className="grid gap-6">
      <PageHeader title="Отчёты">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { const value = period(1); setFilters(value); setAppliedFilters(value); }}>Сегодня</Button>
          <Button variant="secondary" onClick={() => { const value = period(7); setFilters(value); setAppliedFilters(value); }}>7 дней</Button>
          <Button variant="secondary" onClick={() => { const value = period(30); setFilters(value); setAppliedFilters(value); }}>30 дней</Button>
          <Button variant="secondary" onClick={() => { const value = thisMonth(); setFilters(value); setAppliedFilters(value); }}>Этот месяц</Button>
        </div>
      </PageHeader>

      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <SelectField label="Филиал" value={filters.branch || ''} onChange={(value) => setFilters({ ...filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
        <div className="flex items-end">
          <Button onClick={() => setAppliedFilters(filters)}>Обновить</Button>
        </div>
      </Filters>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard title="Доход" value={money(summary.income_total)} />
        <StatCard title="Расход" value={money(summary.expense_total)} tone="red" />
        <StatCard title="Баланс" value={money(summary.balance)} tone="accent" />
        <StatCard title="Средний чек" value={money(summary.avg_check)} tone="green" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Chart title="Доход по дням">
          <LineChart data={dailyFinance.map((item) => ({ ...item, date: dateOnly(item.date), income: Number(item.income || 0), expense: Number(item.expense || 0) }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="income" stroke="#32753E" strokeWidth={2} name="Доход" />
            <Line type="monotone" dataKey="expense" stroke="#dc2626" strokeWidth={2} name="Расход" />
          </LineChart>
        </Chart>
        <Chart title="Доход по источникам">
          <BarChart data={sourceData.map((item) => ({ name: item.source_display || item.source || 'Другое', amount: Number(item.amount || item.total || 0) }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="amount" fill="#32753E" radius={[6, 6, 0, 0]} name="Доход" />
          </BarChart>
        </Chart>
      </section>

      <ReportSection title="Финансы">
        <div className="grid gap-4 xl:grid-cols-2">
          <Table
            data={sourceData}
            empty="Нет доходов по источникам"
            columns={[
              { key: 'source_display', header: 'Источник' },
              { key: 'count', header: 'Кол-во' },
              { key: 'amount', header: 'Сумма', render: (row) => money(row.amount ?? row.total) },
            ]}
          />
          <Table
            data={dailyFinance}
            empty="Нет финансовых операций"
            columns={[
              { key: 'date', header: 'Дата', render: (row) => dateOnly(row.date) },
              { key: 'income', header: 'Доход', render: (row) => money(row.income) },
              { key: 'expense', header: 'Расход', render: (row) => money(row.expense) },
              { key: 'balance', header: 'Баланс', render: (row) => money(row.balance) },
            ]}
          />
        </div>
      </ReportSection>

      <ReportSection title="Продажи">
        <Table
          data={summary.sales_by_manager || []}
          empty="Нет продаж за период"
          columns={[
            { key: 'manager_name', header: 'Менеджер' },
            { key: 'trials_total', header: 'Пробники всего' },
            { key: 'trials_bought', header: 'Купили с пробника' },
            { key: 'trials_conversion', header: 'Конверсия пробников', render: (row) => percent(row.trials_conversion) },
            { key: 'mk_total', header: 'МК всего' },
            { key: 'mk_bought', header: 'Купили после МК' },
            { key: 'mk_conversion', header: 'Конверсия МК', render: (row) => percent(row.mk_conversion) },
            { key: 'income', header: 'Доход', render: (row) => money(row.income) },
          ]}
        />
      </ReportSection>

      <ReportSection title="Группы и уроки">
        <Table
          data={groupAttendance}
          empty="Нет посещаемости по группам"
          columns={[
            { key: 'group_name', header: 'Группа' },
            { key: 'lessons_count', header: 'Уроков' },
            { key: 'students_count', header: 'Учеников' },
            { key: 'attended', header: 'Пришли' },
            { key: 'missed', header: 'Пропустили' },
            { key: 'attendance_rate', header: 'Посещаемость', render: (row) => <Progress value={row.attendance_rate} /> },
          ]}
        />
      </ReportSection>

      <ReportSection title="Учителя">
        <Table
          data={summary.attendance_by_teacher || []}
          empty="Нет посещаемости по учителям"
          columns={[
            { key: 'teacher_name', header: 'Учитель' },
            { key: 'lessons_count', header: 'Уроков' },
            { key: 'attended', header: 'Пришли' },
            { key: 'missed', header: 'Пропустили' },
            { key: 'attendance_rate', header: 'Посещаемость', render: (row) => <Progress value={row.attendance_rate} /> },
          ]}
        />
      </ReportSection>

      <ReportSection title="Абонементы">
        <Table
          data={summary.ending_subscriptions || []}
          empty="Нет заканчивающихся абонементов"
          columns={[
            { key: 'client_name', header: 'Клиент' },
            { key: 'client_phone', header: 'Телефон' },
            { key: 'title', header: 'Абонемент' },
            { key: 'lessons_left', header: 'Остаток', render: (row) => `${row.lessons_left || 0}/${row.lessons_total || 0}` },
            { key: 'end_date', header: 'Дата окончания', render: (row) => dateOnly(row.end_date) },
            { key: 'status', header: 'Статус' },
          ]}
        />
      </ReportSection>

      <ReportSection title="Риски">
        <Table
          data={summary.low_attendance_clients || []}
          empty="Нет учеников с низкой посещаемостью"
          columns={[
            { key: 'client_name', header: 'Клиент' },
            { key: 'client_phone', header: 'Телефон' },
            { key: 'group_name', header: 'Группа' },
            { key: 'attended', header: 'Пришли' },
            { key: 'missed', header: 'Пропустили' },
            { key: 'attendance_rate', header: 'Посещаемость', render: (row) => <Progress value={row.attendance_rate} /> },
          ]}
        />
      </ReportSection>
    </div>
  );
}

function ReportSection({ title, children }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function Chart({ title, children }) {
  return (
    <section className="h-80 rounded-[24px] border border-slate-100 bg-white p-4 shadow-card">
      <h3 className="mb-3 font-semibold text-slate-900">{title}</h3>
      <ResponsiveContainer width="100%" height="88%">
        {children}
      </ResponsiveContainer>
    </section>
  );
}

function Progress({ value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="min-w-32">
      <div className="mb-1 text-xs font-bold text-slate-700">{percent(safeValue)}</div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}
