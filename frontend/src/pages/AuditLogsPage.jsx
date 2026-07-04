import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Table from '../components/ui/Table.jsx';
import { PageHeader, SelectField } from './pageUtils.jsx';

const actionOptions = [
  { value: '', label: 'Все действия' },
  { value: 'create', label: 'Создание' },
  { value: 'update', label: 'Изменение' },
  { value: 'delete', label: 'Удаление' },
  { value: 'login', label: 'Вход' },
  { value: 'import', label: 'Импорт' },
  { value: 'payment', label: 'Оплата' },
  { value: 'visit', label: 'Посещение' },
  { value: 'task_done', label: 'Задача выполнена' },
  { value: 'password_change', label: 'Смена пароля' },
  { value: 'activate', label: 'Активация' },
  { value: 'deactivate', label: 'Деактивация' },
];

const entityOptions = [
  { value: '', label: 'Все объекты' },
  { value: 'Client', label: 'Клиенты' },
  { value: 'Subscription', label: 'Абонементы' },
  { value: 'Trial', label: 'Пробники' },
  { value: 'MasterClass', label: 'МК' },
  { value: 'Visit', label: 'Посещения' },
  { value: 'Task', label: 'Задачи' },
  { value: 'FinanceTransaction', label: 'Финансы' },
  { value: 'User', label: 'Пользователи' },
  { value: 'Settings', label: 'Настройки' },
  { value: 'ExcelImport', label: 'Excel import' },
];

function formatChanges(changes) {
  if (!changes || Object.keys(changes).length === 0) return '';
  return JSON.stringify(changes, null, 2);
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({ search: '', action: '', entity_type: '', date_from: '', date_to: '' });
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('audit-logs/', { params }).then(({ data }) => {
      setLogs(Array.isArray(data) ? data : data.results || []);
    });
  }, [filters]);

  const set = (name, value) => setFilters((current) => ({ ...current, [name]: value }));

  return (
    <>
      <PageHeader title="Журнал действий" />

      <div className="mb-5 grid gap-3 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card lg:grid-cols-[1.3fr_1fr_1fr_0.8fr_0.8fr]">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500">
          <Search size={17} />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Поиск по описанию, объекту или пользователю"
            value={filters.search}
            onChange={(event) => set('search', event.target.value)}
          />
        </label>
        <SelectField label="Действие" value={filters.action} onChange={(value) => set('action', value)} options={actionOptions} />
        <SelectField label="Объект" value={filters.entity_type} onChange={(value) => set('entity_type', value)} options={entityOptions} />
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => set('date_from', event.target.value)} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => set('date_to', event.target.value)} />
      </div>

      <Table
        data={logs}
        columns={[
          { key: 'created_at', header: 'Дата', render: (row) => (row.created_at ? new Date(row.created_at).toLocaleString('ru-RU') : '-') },
          { key: 'user_display', header: 'Пользователь' },
          {
            key: 'action',
            header: 'Действие',
            render: (row) => <Badge value={row.action}>{actionOptions.find((item) => item.value === row.action)?.label || row.action}</Badge>,
          },
          { key: 'entity_type', header: 'Объект', render: (row) => `${row.entity_type}${row.entity_name ? `: ${row.entity_name}` : ''}` },
          {
            key: 'description',
            header: 'Описание',
            render: (row) => {
              const details = formatChanges(row.changes);
              return (
                <div className="max-w-xl whitespace-normal text-left">
                  <p>{row.description || '-'}</p>
                  {details && (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand"
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      {expandedId === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Детали
                    </button>
                  )}
                  {expandedId === row.id && details && (
                    <pre className="mt-2 max-h-44 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">{details}</pre>
                  )}
                </div>
              );
            },
          },
          { key: 'ip_address', header: 'IP' },
        ]}
        empty="Журнал действий пока пуст"
      />
    </>
  );
}
