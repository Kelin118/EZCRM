import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import useBranches from '../hooks/useBranches.js';
import { Badge, Filters, Input, money, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
};
const monthEndIso = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
};
const addDaysIso = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const dateOnly = (value) => (value ? new Date(value).toLocaleDateString('ru-RU') : '—');
const timeOnly = (value) => (value ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
const stageLabel = (value) => ({
  lead: 'Лид',
  booked: 'Записался',
  attended: 'Пришел',
  paid: 'Оплатил',
  bought: 'Купил абонемент',
  lost: 'Не купил',
  planned: 'Запланирован',
  completed: 'Завершён',
  cancelled: 'Отменён',
}[value] || value || '—');
const clientDisplay = (item) => item.client_display_name || item.client_name || item.client?.display_name || item.client?.full_name || 'Не указан';

export default function MasterClassesOutsideHoursPage() {
  const [filters, setFilters] = useState({
    event_date_from: monthStartIso(),
    event_date_to: monthEndIso(),
    branch: 'all',
    teacher: '',
    manager: '',
    search: '',
  });
  const [items, setItems] = useState([]);
  const [unmarkedItems, setUnmarkedItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUnmarked, setShowUnmarked] = useState(false);
  const { branchFilterOptions } = useBranches();
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['admin', 'teacher']);
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);

  useEffect(() => {
    const params = { extra_work: 'true' };
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) params[key] = value;
    });
    const unmarkedParams = { ...params, extra_work: 'false', outside_regular_hours: 'true' };
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.get('master-classes/', { params }),
      api.get('master-classes/', { params: unmarkedParams }),
    ])
      .then(([mainResponse, unmarkedResponse]) => {
        if (!mounted) return;
        setItems(Array.isArray(mainResponse.data) ? mainResponse.data : mainResponse.data?.results || []);
        setUnmarkedItems(Array.isArray(unmarkedResponse.data) ? unmarkedResponse.data : unmarkedResponse.data?.results || []);
      })
      .catch(showApiError)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [filters]);

  useEffect(() => {
    api.get('employee-payroll-profiles/').then(({ data }) => setProfiles(Array.isArray(data) ? data : data.results || [])).catch(() => setProfiles([]));
  }, []);

  const visibleItems = showUnmarked ? unmarkedItems : items;

  const teacherSummary = useMemo(() => {
    const map = new Map();
    const profileByEmployee = new Map(profiles.map((profile) => [String(profile.employee), profile]));
    items.forEach((item) => {
      const name = item.teacher_name || 'Мастер не указан';
      const current = map.get(name) || { name, count: 0, minutes: 0, pay: 0, missingRate: false };
      const profile = profileByEmployee.get(String(item.teacher));
      const rate = Number(profile?.outside_hourly_rate || 0);
      const bonus = Number(profile?.outside_master_class_bonus || 0);
      const duration = Number(item.duration_minutes || 0);
      current.count += 1;
      current.minutes += duration;
      if (!profile || (!rate && !bonus)) current.missingRate = true;
      else current.pay += (duration / 60) * rate + bonus;
      map.set(name, current);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [items, profiles]);

  const setRange = (from, to) => setFilters((current) => ({ ...current, event_date_from: from, event_date_to: to }));

  return (
    <>
      <PageHeader title="МК вне времени">
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Дополнительных МК: {items.length}</span>
      </PageHeader>
      <Filters>
        <Input label="Дата от" type="date" value={filters.event_date_from} onChange={(event) => setFilters({ ...filters, event_date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.event_date_to} onChange={(event) => setFilters({ ...filters, event_date_to: event.target.value })} />
        <SelectField label="Филиал" value={filters.branch} onChange={(value) => setFilters({ ...filters, branch: value })} options={branchFilterOptions} />
        <SelectField label="Мастер / преподаватель" value={filters.teacher} onChange={(value) => setFilters({ ...filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
        <SelectField label="Менеджер" value={filters.manager} onChange={(value) => setFilters({ ...filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <Input label="Поиск" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <Button variant="secondary" onClick={() => setRange(todayIso(), todayIso())}>Сегодня</Button>
          <Button variant="secondary" onClick={() => setRange(todayIso(), addDaysIso(6))}>7 дней</Button>
          <Button variant="secondary" onClick={() => setRange(monthStartIso(), monthEndIso())}>Этот месяц</Button>
        </div>
      </Filters>

      <div className="mb-5 grid gap-4 md:grid-cols-[1fr_2fr]">
        <section className="rounded-[24px] bg-slate-950 p-5 text-white shadow-card">
          <p className="text-sm font-semibold text-white/55">МК вне времени</p>
          <p className="mt-2 text-4xl font-black">{items.length}</p>
          <p className="mt-2 text-sm text-white/60">Здесь отображаются МК, которые вручную отмечены как дополнительный выход мастера.</p>
          <div className="mt-4 rounded-2xl bg-amber-400/15 p-3 text-sm text-amber-100">
            <p className="font-bold">Неотмеченные МК вне стандартного времени: {unmarkedItems.length}</p>
            <p className="mt-1 text-amber-100/80">Это контроль по времени 16:00–21:00, не подтверждённая доплата.</p>
            <Button className="mt-3" variant="secondary" onClick={() => setShowUnmarked((value) => !value)}>
              {showUnmarked ? 'Показать дополнительные' : 'Показать'}
            </Button>
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
          <p className="text-sm font-bold text-slate-900">Сводка по мастерам</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {teacherSummary.length ? teacherSummary.map((item) => (
              <div key={item.name} className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-900">{item.name}</p>
                <p className="text-sm text-slate-500">{item.count} МК · {Math.floor(item.minutes / 60)} ч {item.minutes % 60} мин</p>
                <p className={`text-sm font-semibold ${item.missingRate ? 'text-amber-700' : 'text-brand'}`}>Доплата: {item.missingRate ? 'ставка не настроена' : money(item.pay)}</p>
              </div>
            )) : <p className="text-sm text-slate-500">Нет МК вне графика за выбранный период.</p>}
          </div>
        </section>
      </div>

      <Table
        data={visibleItems}
        empty={loading ? 'Загрузка...' : 'Нет МК вне времени'}
        columns={[
          { key: 'date', header: 'Дата', render: (row) => dateOnly(row.starts_at) },
          { key: 'time', header: 'Время', render: (row) => timeOnly(row.starts_at) },
          { key: 'duration_minutes', header: 'Длительность', render: (row) => row.duration_minutes ? `${row.duration_minutes} мин` : 'Не указана' },
          { key: 'client', header: 'Клиент', render: (row) => clientDisplay(row) },
          { key: 'phone', header: 'Телефон', render: (row) => row.client_phone || '—' },
          { key: 'title', header: 'МК' },
          { key: 'teacher', header: 'Мастер', render: (row) => row.teacher_name || '—' },
          { key: 'manager', header: 'Менеджер', render: (row) => row.manager_name || '—' },
          { key: 'branch', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
          { key: 'stage', header: 'Статус', render: (row) => <Badge value={row.stage}>{stageLabel(row.stage)}</Badge> },
          { key: 'payment_amount', header: 'Оплачено', render: (row) => money(row.payment_amount) },
          { key: 'reason', header: 'Причина', render: (row) => row.outside_regular_hours_reason || '—' },
          { key: 'extra_pay', header: 'Доплата', render: (row) => {
            if (!row.is_extra_work) return 'Не отмечено';
            const profile = profiles.find((item) => String(item.employee) === String(row.teacher));
            const rate = Number(profile?.outside_hourly_rate || 0);
            const bonus = Number(profile?.outside_master_class_bonus || 0);
            if (!profile || (!rate && !bonus)) return 'Ставка не настроена';
            return money((Number(row.duration_minutes || 0) / 60) * rate + bonus);
          } },
        ]}
      />
    </>
  );
}
