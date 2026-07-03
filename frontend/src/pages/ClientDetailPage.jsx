import { ArrowLeft, CalendarPlus, CheckSquare, CreditCard, Plus, UserCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import api from '../api/axios.js';
import { canCreateTasks, canManageSubscriptions, canManageVisits, getRole, getStoredUser, ROLES } from '../auth.js';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Table from '../components/ui/Table.jsx';
import { money } from './pageUtils.jsx';
import { visitStatusOptions } from './VisitsPage.jsx';

const tabs = [
  { key: 'subscriptions', label: 'Абонементы' },
  { key: 'trials', label: 'Пробники' },
  { key: 'masterClasses', label: 'МК' },
  { key: 'visits', label: 'Посещения', roles: [ROLES.ADMIN, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { key: 'finance', label: 'Финансы', roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { key: 'tasks', label: 'Задачи', roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.TEACHER] },
];

export default function ClientDetailPage() {
  const { id } = useParams();
  const user = getStoredUser();
  const role = getRole(user);
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.roles || role === ROLES.ADMIN || tab.roles.includes(role)),
    [role],
  );
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
      const getList = (endpoint) => api.get(endpoint, { params: { client: id } });
      const [clientRes, subscriptions, trials, masterClasses, visits, finance, tasks] = await Promise.all([
        api.get(`clients/${id}/`),
        getList('subscriptions/'),
        getList('trials/'),
        getList('master-classes/'),
        visibleTabs.some((tab) => tab.key === 'visits') ? getList('visits/') : Promise.resolve({ data: [] }),
        visibleTabs.some((tab) => tab.key === 'finance') ? getList('finance/') : Promise.resolve({ data: [] }),
        visibleTabs.some((tab) => tab.key === 'tasks') ? getList('tasks/') : Promise.resolve({ data: [] }),
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
  }, [id, visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'subscriptions');
    }
  }, [activeTab, visibleTabs]);

  const fullName = useMemo(() => `${client?.first_name || ''} ${client?.last_name || ''}`.trim(), [client]);

  if (!client) {
    return <div className="rounded-[24px] bg-white p-6 text-slate-500 shadow-card">Загрузка карточки клиента...</div>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <Link to="/clients">
          <Button variant="secondary">
            <ArrowLeft size={17} />
            Назад
          </Button>
        </Link>
      </div>

      <section className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-brand/10 text-brand">
              <UserCircle size={36} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-3xl font-bold text-slate-900">{fullName || `Клиент #${client.id}`}</h2>
                <Badge value={client.is_active ? 'active' : 'cancelled'}>{client.is_active ? 'Активен' : 'Неактивен'}</Badge>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-500">Карточка ученика и связанные активности</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Родитель" value={client.parent_name} />
                <Info label="Телефон" value={client.phone} />
                <Info label="Класс" value={client.school_class} />
                <Info label="Направление" value={client.direction} />
                <Info label="Менеджер" value={client.manager_name || client.manager} />
                <Info label="Комментарий" value={client.notes} wide />
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[430px]">
            {canManageSubscriptions(user) && <QuickAction to="/subscriptions" icon={CreditCard} label="Абонемент" />}
            {canCreateTasks(user) && <QuickAction to="/tasks" icon={CheckSquare} label="Задача" />}
            {canManageVisits(user) && <QuickAction to="/visits" icon={CalendarPlus} label="Посещение" />}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-card">
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50/60 p-3 scrollbar-thin">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.key ? 'bg-brand text-white shadow-md shadow-brand/20' : 'bg-white text-slate-600 hover:bg-brand/5 hover:text-brand'
              }`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
              <span className="ml-2 rounded-full bg-black/5 px-2 py-0.5 text-xs">{data[tab.key]?.length || 0}</span>
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
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value || '—'}</p>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <Link to={to}>
      <Button variant="secondary" className="w-full justify-start">
        <Icon size={17} />
        <Plus size={14} />
        {label}
      </Button>
    </Link>
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
      { key: 'status', header: 'Этап', render: (row) => <Badge value={row.stage ?? row.status} /> },
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
      { key: 'subscription', header: 'Абонемент', render: (row) => row.subscription_title || '—' },
      { key: 'teacher', header: 'Учитель', render: (row) => row.teacher_name || '—' },
      { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{visitStatusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
      { key: 'notes', header: 'Комментарий' },
    ]} />;
  }
  if (activeTab === 'finance') {
    return <Table data={data.finance} columns={[
      { key: 'transaction_type', header: 'Тип', render: (row) => <Badge value={row.type ?? row.transaction_type} /> },
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
