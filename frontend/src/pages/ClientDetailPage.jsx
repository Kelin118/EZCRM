import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import api from '../api/axios.js';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Table from '../components/ui/Table.jsx';
import { money } from './pageUtils.jsx';
import { visitStatusOptions } from './VisitsPage.jsx';

const tabs = [
  { key: 'subscriptions', label: 'Абонементы' },
  { key: 'trials', label: 'Пробники' },
  { key: 'masterClasses', label: 'МК' },
  { key: 'visits', label: 'Посещения' },
  { key: 'finance', label: 'Финансы' },
  { key: 'tasks', label: 'Задачи' },
];

export default function ClientDetailPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [data, setData] = useState({
    subscriptions: [],
    trials: [],
    masterClasses: [],
    visits: [],
    finance: [],
    tasks: [],
  });

  useEffect(() => {
    async function load() {
      const [clientRes, subscriptions, trials, masterClasses, visits, finance, tasks] = await Promise.all([
        api.get(`clients/${id}/`),
        api.get('subscriptions/', { params: { client: id } }),
        api.get('trials/', { params: { client: id } }),
        api.get('master-classes/', { params: { client: id } }),
        api.get('visits/', { params: { client: id } }),
        api.get('finance/', { params: { client: id } }),
        api.get('tasks/', { params: { client: id } }),
      ]);

      setClient(clientRes.data);
      setData({
        subscriptions: list(subscriptions.data),
        trials: list(trials.data),
        masterClasses: list(masterClasses.data),
        visits: list(visits.data),
        finance: list(finance.data),
        tasks: list(tasks.data),
      });
    }

    load();
  }, [id]);

  const fullName = useMemo(() => `${client?.first_name || ''} ${client?.last_name || ''}`.trim(), [client]);

  if (!client) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Загрузка карточки клиента...</div>;
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <Link to="/clients">
          <Button variant="secondary">
            <ArrowLeft size={17} />
            Назад
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{fullName || `Клиент #${client.id}`}</h2>
          <p className="text-sm text-slate-500">Карточка ученика</p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <Info label="ФИО ученика" value={fullName} />
          <Info label="Родитель" value={client.parent_name} />
          <Info label="Телефон" value={client.phone} />
          <Info label="Класс" value={client.school_class} />
          <Info label="Направление" value={client.direction} />
          <Info label="Менеджер" value={client.manager_name || client.manager} />
          <Info label="Статус" value={client.is_active ? 'Активен' : 'Неактивен'} />
          <Info label="Комментарий" value={client.notes} wide />
        </div>
      </section>

      <section className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2 scrollbar-thin">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${activeTab === tab.key ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="p-4">{renderTab(activeTab, data)}</div>
      </section>
    </div>
  );
}

function list(data) {
  return Array.isArray(data) ? data : data.results || [];
}

function Info({ label, value, wide }) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value || '—'}</p>
    </div>
  );
}

function renderTab(activeTab, data) {
  if (activeTab === 'subscriptions') {
    return <Table data={data.subscriptions} columns={[
      { key: 'title', header: 'Название' },
      { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status} /> },
      { key: 'used_lessons', header: 'Использовано' },
      { key: 'lessons_left', header: 'Осталось' },
      { key: 'paid_amount', header: 'Оплачено', render: (row) => money(row.paid_amount) },
    ]} />;
  }
  if (activeTab === 'trials') {
    return <Table data={data.trials} columns={[
      { key: 'scheduled_at', header: 'Дата', render: (row) => row.scheduled_at ? new Date(row.scheduled_at).toLocaleString('ru-RU') : '—' },
      { key: 'status', header: 'Этап', render: (row) => <Badge value={row.status} /> },
      { key: 'price', header: 'Сумма', render: (row) => money(row.price) },
      { key: 'bought_subscription', header: 'Купил', render: (row) => row.bought_subscription ? 'Да' : 'Нет' },
    ]} />;
  }
  if (activeTab === 'masterClasses') {
    return <Table data={data.masterClasses} columns={[
      { key: 'title', header: 'Название' },
      { key: 'starts_at', header: 'Дата', render: (row) => row.starts_at ? new Date(row.starts_at).toLocaleString('ru-RU') : '—' },
      { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage} /> },
      { key: 'payment_amount', header: 'Оплачено', render: (row) => money(row.payment_amount) },
    ]} />;
  }
  if (activeTab === 'visits') {
    return <Table data={data.visits} columns={[
      { key: 'visited_at', header: 'Дата', render: (row) => row.visited_at ? new Date(row.visited_at).toLocaleString('ru-RU') : '—' },
      { key: 'subscription', header: 'Абонемент ID' },
      { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{visitStatusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
      { key: 'lesson_deducted', header: 'Списано', render: (row) => row.lesson_deducted ? 'Да' : 'Нет' },
    ]} />;
  }
  if (activeTab === 'finance') {
    return <Table data={data.finance} columns={[
      { key: 'transaction_type', header: 'Тип', render: (row) => <Badge value={row.transaction_type} /> },
      { key: 'source', header: 'Источник' },
      { key: 'amount', header: 'Сумма', render: (row) => money(row.amount) },
      { key: 'paid_at', header: 'Дата', render: (row) => row.paid_at ? new Date(row.paid_at).toLocaleString('ru-RU') : '—' },
      { key: 'comment', header: 'Описание' },
    ]} />;
  }
  return <Table data={data.tasks} columns={[
    { key: 'title', header: 'Задача' },
    { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status} /> },
    { key: 'due_at', header: 'Срок', render: (row) => row.due_at ? new Date(row.due_at).toLocaleString('ru-RU') : '—' },
  ]} />;
}
