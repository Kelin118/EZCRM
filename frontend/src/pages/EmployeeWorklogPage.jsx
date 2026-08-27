import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import useBranches from '../hooks/useBranches.js';
import { Badge, Filters, Input, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const monthEndIso = () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
const addDaysIso = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const minutes = (value) => `${Math.floor(Number(value || 0) / 60)} ч ${Number(value || 0) % 60} мин`;
const time = (value) => value ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';

export default function EmployeeWorklogPage() {
  const [filters, setFilters] = useState({ date_from: monthStartIso(), date_to: monthEndIso(), branch: 'all', employee: '', source: 'all' });
  const [data, setData] = useState({ summary: {}, entries: [] });
  const { branchFilterOptions } = useBranches();
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher', 'accountant']);

  useEffect(() => {
    api.get('employee-worklog/', { params: filters }).then(({ data }) => setData(data)).catch(showApiError);
  }, [filters]);

  const setRange = (from, to) => setFilters((current) => ({ ...current, date_from: from, date_to: to }));

  return (
    <>
      <PageHeader title="Учёт времени" />
      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
        <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
        <SelectField label="Источник" value={filters.source} onChange={(source) => setFilters({ ...filters, source })} options={[{ value: 'all', label: 'Все' }, { value: 'master_class', label: 'МК' }, { value: 'lesson', label: 'Уроки' }]} />
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <Button variant="secondary" onClick={() => setRange(todayIso(), todayIso())}>Сегодня</Button>
          <Button variant="secondary" onClick={() => setRange(todayIso(), addDaysIso(6))}>Неделя</Button>
          <Button variant="secondary" onClick={() => setRange(monthStartIso(), monthEndIso())}>Этот месяц</Button>
        </div>
      </Filters>
      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-[22px] bg-white p-4 shadow-card"><p className="text-xs text-slate-400">Всего часов</p><p className="text-xl font-bold">{minutes(data.summary.total_minutes)}</p></div>
        <div className="rounded-[22px] bg-white p-4 shadow-card"><p className="text-xs text-slate-400">Обычных часов</p><p className="text-xl font-bold">{minutes(data.summary.regular_minutes)}</p></div>
        <div className="rounded-[22px] bg-white p-4 shadow-card"><p className="text-xs text-slate-400">Дополнительных часов</p><p className="text-xl font-bold">{minutes(data.summary.outside_minutes)}</p></div>
        <div className="rounded-[22px] bg-white p-4 shadow-card"><p className="text-xs text-slate-400">Записей с ошибкой</p><p className="text-xl font-bold">{data.summary.warning_count || 0}</p></div>
      </section>
      <Table data={data.entries || []} columns={[
        { key: 'date', header: 'Дата' },
        { key: 'employee_name', header: 'Сотрудник' },
        { key: 'source', header: 'Источник', render: (row) => row.source === 'master_class' ? 'МК' : 'Урок' },
        { key: 'title', header: 'Работа', render: (row) => <div>{row.title}{row.is_extra_work && <p className="mt-1"><Badge value="outside">Вне времени МК</Badge></p>}{row.warning && <p className="text-xs text-amber-700">{row.warning}</p>}</div> },
        { key: 'starts_at', header: 'Начало', render: (row) => time(row.starts_at) },
        { key: 'ends_at', header: 'Конец', render: (row) => time(row.ends_at) },
        { key: 'duration_minutes', header: 'Всего', render: (row) => minutes(row.duration_minutes) },
        { key: 'regular_minutes', header: 'По графику', render: (row) => minutes(row.regular_minutes) },
        { key: 'outside_minutes', header: 'Вне графика', render: (row) => minutes(row.outside_minutes) },
        { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
      ]} />
    </>
  );
}
