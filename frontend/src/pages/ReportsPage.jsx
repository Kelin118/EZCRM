import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import api from '../api/axios.js';
import StatCard from '../components/ui/StatCard.jsx';
import { Filters, Input, money, PageHeader } from './pageUtils.jsx';

export default function ReportsPage() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '' });
  const [summary, setSummary] = useState({});

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('reports/summary/', { params }).then(({ data }) => setSummary(data));
  }, [filters]);

  const sourceData = (summary.income_by_source || []).map((item) => ({ name: item.source || 'Без источника', total: Number(item.total || 0) }));
  const managerData = (summary.income_by_managers || []).map((item) => ({ name: item.created_by__username || `ID ${item.created_by || '-'}`, total: Number(item.total || 0) }));
  const dayData = (summary.payments_by_day || []).map((item) => ({ day: item.day || '—', total: Number(item.total || 0) }));

  return (
    <>
      <PageHeader title="Отчёты" />
      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
      </Filters>
      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <StatCard title="Доход" value={money(summary.income_total)} />
        <StatCard title="Расход" value={money(summary.expense_total)} tone="red" />
        <StatCard title="Баланс" value={money(summary.balance)} tone="accent" />
        <StatCard title="Конверсия" value={`${summary.trials_conversion || 0}%`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Chart title="Доход по дням">
          <LineChart data={dayData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="total" stroke="#32753E" strokeWidth={2} />
          </LineChart>
        </Chart>
        <Chart title="Доход по источникам">
          <BarChart data={sourceData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total" fill="#32753E" radius={[6, 6, 0, 0]} />
          </BarChart>
        </Chart>
        <Chart title="Доход по менеджерам">
          <BarChart data={managerData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total" fill="#DECDA6" radius={[6, 6, 0, 0]} />
          </BarChart>
        </Chart>
      </div>
    </>
  );
}

function Chart({ title, children }) {
  return (
    <section className="h-80 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-slate-900">{title}</h3>
      <ResponsiveContainer width="100%" height="88%">
        {children}
      </ResponsiveContainer>
    </section>
  );
}
