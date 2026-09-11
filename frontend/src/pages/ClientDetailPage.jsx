import { ArrowLeft, CalendarPlus, CheckSquare, CreditCard, Plus, UserCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import api from '../api/axios.js';
import { canCreateTasks, canManageSubscriptions, canManageVisits, getStoredUser, hasAnyRole, isAdmin, ROLES } from '../auth.js';
import PaymentSplitFields, { paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Table from '../components/ui/Table.jsx';
import { Input, SelectField, money, showApiError } from './pageUtils.jsx';
import { visitStatusOptions } from './VisitsPage.jsx';

const tabs = [
  { key: 'subscriptions', label: 'Абонементы' },
  { key: 'payments', label: 'Оплаты' },
  { key: 'trials', label: 'Пробники' },
  { key: 'masterClasses', label: 'МК' },
  { key: 'visits', label: 'Посещения', roles: [ROLES.ADMIN, ROLES.TEACHER, ROLES.ACCOUNTANT] },
  { key: 'finance', label: 'Финансы', roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT] },
  { key: 'tasks', label: 'Задачи', roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.TEACHER] },
];
const todayIso = () => new Date().toISOString().slice(0, 10);
const paymentTypeLabels = { prepayment: 'Предоплата', additional: 'Доплата', legacy: 'Ранее внесена' };
const paymentStatusLabels = { unpaid: 'Не оплачено', partial: 'Частично', paid: 'Оплачено', overpaid: 'Переплата' };

export default function ClientDetailPage() {
  const { id } = useParams();
  const user = getStoredUser();
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.roles || isAdmin(user) || hasAnyRole(user, tab.roles)),
    [user],
  );
  const [client, setClient] = useState(null);
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [data, setData] = useState({
    subscriptions: [],
    payments: [],
    trials: [],
    masterClasses: [],
    visits: [],
    finance: [],
    tasks: [],
  });
  const [paymentModal, setPaymentModal] = useState({ open: false, masterClass: null });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: todayIso(), payment_parts: [], comment: '' });
  const [paymentSaving, setPaymentSaving] = useState(false);

  const load = useCallback(async () => {
      const getList = (endpoint) => api.get(endpoint, { params: { client: id } });
      const [clientRes, subscriptions, payments, trials, masterClasses, visits, finance, tasks] = await Promise.all([
        api.get(`clients/${id}/`),
        getList('subscriptions/'),
        api.get(`clients/${id}/master-class-payments/`),
        getList('trials/'),
        getList('master-classes/'),
        visibleTabs.some((tab) => tab.key === 'visits') ? getList('visits/') : Promise.resolve({ data: [] }),
        visibleTabs.some((tab) => tab.key === 'finance') ? getList('finance/') : Promise.resolve({ data: [] }),
        visibleTabs.some((tab) => tab.key === 'tasks') ? getList('tasks/') : Promise.resolve({ data: [] }),
      ]);

      setClient(clientRes.data);
      setData({
        subscriptions: list(subscriptions.data),
        payments: list(payments.data),
        trials: list(trials.data),
        masterClasses: list(masterClasses.data),
        visits: list(visits.data),
        finance: list(finance.data),
        tasks: list(tasks.data),
      });
  }, [id, visibleTabs]);

  useEffect(() => { load().catch(showApiError); }, [load]);

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
        <div className="p-4">{renderTab(activeTab, data, {
          canPay: hasAnyRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT]),
          onAddPayment: (masterClass) => {
            setPaymentModal({ open: true, masterClass });
            setPaymentForm({ amount: masterClass.remaining_amount || '', payment_date: todayIso(), payment_parts: [], comment: '' });
          },
        })}</div>
      </section>

      <Modal
        title="Добавить доплату"
        open={paymentModal.open}
        onClose={() => setPaymentModal({ open: false, masterClass: null })}
        footer={<><Button variant="secondary" onClick={() => setPaymentModal({ open: false, masterClass: null })}>Отмена</Button><Button disabled={paymentSaving} onClick={async () => {
          const amount = Number(paymentForm.amount || 0);
          if (amount <= 0 || paymentPartsTotal(paymentForm.payment_parts) !== amount) {
            window.dispatchEvent(new CustomEvent('api-error', { detail: 'Проверьте сумму и распределение оплаты.' }));
            return;
          }
          setPaymentSaving(true);
          try {
            await api.post(`master-classes/${paymentModal.masterClass.id}/payments/`, {
              payment_type: 'additional',
              amount: paymentForm.amount,
              payment_date: paymentForm.payment_date,
              payment_parts: paymentPartsPayload(paymentForm.payment_parts),
              comment: paymentForm.comment,
            });
            setPaymentModal({ open: false, masterClass: null });
            await load();
          } catch (error) {
            showApiError(error);
          } finally {
            setPaymentSaving(false);
          }
        }}>{paymentSaving ? 'Сохраняем...' : 'Сохранить'}</Button></>}
      >
        <div className="grid gap-4">
          <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            <p>{paymentModal.masterClass?.title || 'МК'}</p>
            <p className="mt-1 text-slate-500">Остаток: {money(paymentModal.masterClass?.remaining_amount)}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Сумма" type="number" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
            <Input label="Дата оплаты" type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} />
          </div>
          <PaymentSplitFields totalAmount={paymentForm.amount} value={paymentForm.payment_parts} onChange={(payment_parts) => setPaymentForm({ ...paymentForm, payment_parts })} />
          <Input label="Комментарий" value={paymentForm.comment} onChange={(event) => setPaymentForm({ ...paymentForm, comment: event.target.value })} />
        </div>
      </Modal>
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

function renderTab(activeTab, data, actions = {}) {
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
  if (activeTab === 'payments') {
    const financeRest = data.finance.filter((row) => row.source !== 'master_class');
    return (
      <div className="grid gap-5">
        <div className="grid gap-3">
          {data.payments.length ? data.payments.map((item) => (
            <section key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-bold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{item.starts_at ? new Date(item.starts_at).toLocaleString('ru-RU') : 'Дата не указана'} · {item.branch_name || 'Филиал не указан'}</p>
                </div>
                <div className="grid gap-1 text-sm font-semibold text-slate-700 sm:text-right">
                  <span>К оплате: {money(item.amount_due ?? item.price)}</span>
                  <span>Оплачено: {money(item.paid_total ?? item.payment_amount)}</span>
                  <span>Остаток: {money(item.remaining_amount)}</span>
                  <Badge value={item.payment_status}>{paymentStatusLabels[item.payment_status] || item.payment_status}</Badge>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {(item.payments || []).length ? item.payments.map((payment) => (
                  <div key={payment.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <p className="font-bold text-slate-900">{paymentTypeLabels[payment.payment_type] || payment.payment_type} · {money(payment.amount)}</p>
                      <p className="text-xs font-semibold text-slate-500">{payment.payment_date || 'Дата не указана'} · {payment.accepted_by_name || 'Принял не указан'}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{payment.payment_parts?.length ? payment.payment_parts.map((part) => `${part.payment_method_name}: ${money(part.amount)}`).join(' / ') : (payment.payment_method_name || 'Способ не указан')}</p>
                    {payment.comment && <p className="mt-1 text-xs text-slate-500">{payment.comment}</p>}
                  </div>
                )) : <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">Оплат по МК пока нет</div>}
              </div>
              {actions.canPay && Number(item.remaining_amount || 0) > 0 && <Button className="mt-4" variant="secondary" onClick={() => actions.onAddPayment(item)}>Добавить доплату</Button>}
            </section>
          )) : <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">Оплат по МК пока нет</div>}
        </div>
        {financeRest.length > 0 && (
          <section className="grid gap-3">
            <h3 className="text-sm font-bold text-slate-900">Другие финансовые операции</h3>
            <Table data={financeRest} columns={[
              { key: 'source', header: 'Источник' },
              { key: 'amount', header: 'Сумма', render: (row) => money(row.amount) },
              { key: 'paid_at', header: 'Дата', render: (row) => row.paid_at ? new Date(row.paid_at).toLocaleString('ru-RU') : '—' },
              { key: 'comment', header: 'Комментарий' },
            ]} />
          </section>
        )}
      </div>
    );
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
