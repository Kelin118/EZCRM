import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import { Filters, Input, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const todayIso = () => new Date().toISOString().slice(0, 10);
const empty = { employee: '', branch: '', weekday: 0, start_time: '16:00', end_time: '21:00', is_working_day: true, valid_from: todayIso(), valid_until: '' };

export default function EmployeeSchedulePage() {
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ employee: '', branch: 'all' });
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const { branchOptions, branchFilterOptions } = useBranches();
  const { employees, employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher', 'accountant']);

  const load = async () => {
    const { data } = await api.get('employee-schedules/', { params: filters });
    setItems(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => { load().catch(showApiError); }, [filters]);

  const rows = useMemo(() => {
    const map = new Map();
    employees.forEach((employee) => map.set(String(employee.id), { employee, days: Array(7).fill(null) }));
    items.forEach((item) => {
      const key = String(item.employee);
      if (!map.has(key)) map.set(key, { employee: { id: item.employee, display_name: item.employee_name }, days: Array(7).fill(null) });
      map.get(key).days[item.weekday] = item;
    });
    return Array.from(map.values()).filter((row) => !filters.employee || String(row.employee.id) === String(filters.employee));
  }, [employees, items, filters.employee]);

  const openCell = (employee, weekday, item = null) => {
    setEditing(item ? { ...item, employee: String(item.employee), branch: item.branch ? String(item.branch) : '', weekday } : { ...empty, employee: String(employee.id), weekday });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...editing, branch: editing.branch || null, valid_until: editing.valid_until || null };
      if (editing.id) await api.patch(`employee-schedules/${editing.id}/`, payload);
      else await api.post('employee-schedules/', payload);
      setEditing(null);
      await load();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="График сотрудников" actionLabel="Добавить смену" onAction={() => setEditing(empty)} />
      <Filters>
        <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
        <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
      </Filters>
      <Table
        data={rows.map((row) => ({ id: row.employee.id, ...row }))}
        columns={[
          { key: 'employee', header: 'Сотрудник', render: (row) => row.employee.display_name || row.employee.full_name || row.employee.username },
          ...weekdays.map((label, index) => ({
            key: `day-${index}`,
            header: label,
            render: (row) => {
              const item = row.days[index];
              return (
                <button type="button" className="rounded-xl px-3 py-2 text-left text-sm hover:bg-brand/5" onClick={() => openCell(row.employee, index, item)}>
                  {item ? (item.is_working_day ? `${item.start_time?.slice(0, 5)}–${item.end_time?.slice(0, 5)}` : 'Выходной') : '—'}
                </button>
              );
            },
          })),
        ]}
      />
      <Modal title="Редактировать смену" open={Boolean(editing)} onClose={() => setEditing(null)} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Отмена</Button><Button onClick={save} disabled={saving}>Сохранить</Button></>}>
        {editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Сотрудник" value={editing.employee} onChange={(employee) => setEditing({ ...editing, employee })} options={employeeOptions} />
            <SelectField label="День недели" value={String(editing.weekday)} onChange={(weekday) => setEditing({ ...editing, weekday: Number(weekday) })} options={weekdays.map((label, index) => ({ value: String(index), label }))} />
            <SelectField label="Филиал" value={editing.branch || ''} onChange={(branch) => setEditing({ ...editing, branch })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
            <SelectField label="Рабочий день" value={editing.is_working_day ? '1' : '0'} onChange={(value) => setEditing({ ...editing, is_working_day: value === '1' })} options={[{ value: '1', label: 'Да' }, { value: '0', label: 'Нет' }]} />
            <Input label="Дата действия с" type="date" value={editing.valid_from} onChange={(event) => setEditing({ ...editing, valid_from: event.target.value })} />
            <Input label="Дата действия до" type="date" value={editing.valid_until || ''} onChange={(event) => setEditing({ ...editing, valid_until: event.target.value })} />
            <Input label="Начало" type="time" value={editing.start_time?.slice(0, 5) || ''} onChange={(event) => setEditing({ ...editing, start_time: event.target.value })} />
            <Input label="Конец" type="time" value={editing.end_time?.slice(0, 5) || ''} onChange={(event) => setEditing({ ...editing, end_time: event.target.value })} />
          </div>
        )}
      </Modal>
    </>
  );
}
