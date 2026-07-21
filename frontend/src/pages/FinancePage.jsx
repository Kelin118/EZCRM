import { ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageFinance, getStoredUser } from '../auth.js';
import AddonSaleModal from '../components/sales/AddonSaleModal.jsx';
import PaymentSplitFields, { partsFromTransaction, paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import useDiscounts from '../hooks/useDiscounts.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';
import { subscriptionLabel, useClientOptions, useEmployeeOptions, useLookup } from './lookupUtils.jsx';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const empty = { transaction_type: 'income', amount: 0, source: 'manual', payment_method: '', client: '', subscription: '', paid_at: '', comment: '', branch: '' };
const emptyFilters = { transaction_type: '', source: '', payment_method: 'all', discount: 'all', manager: 'all', client: '', search: '', date_from: '', date_to: '', branch: 'all' };
const emptyCashForm = { branch: '', amount: '', comment: '' };
const sourceOptions = [
  { value: 'subscription', label: 'Абонемент' }, { value: 'trial', label: 'Пробник' },
  { value: 'master_class', label: 'Мастер-класс' }, { value: 'addon', label: 'Дополнительные услуги' },
  { value: 'camp', label: '\u041b\u0430\u0433\u0435\u0440\u044c' },
  { value: 'product', label: '\u0422\u043e\u0432\u0430\u0440' }, { value: 'retail', label: '\u0422\u043e\u0432\u0430\u0440\u044b \u0438 \u0443\u0441\u043b\u0443\u0433\u0438' },
  { value: 'manual', label: 'Ручная операция' }, { value: 'salary', label: 'Зарплата' },
  { value: 'rent', label: 'Аренда' }, { value: 'other', label: 'Другое' },
];
const sourceLabel = (value) => sourceOptions.find((item) => item.value === value)?.label || value || 'Другое';
const typeLabel = (value) => (value === 'income' ? 'Доход' : value === 'expense' ? 'Расход' : value);

function dispatchError(message) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}

export default function FinancePage() {
  const crud = useCrudResource('finance/', emptyFilters);
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentOptions } = usePaymentMethods({ activeOnly: true });
  const { options: discountOptions } = useDiscounts({ branch: crud.filters.branch });
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0, transactions_count: 0, average_income: 0 });
  const [cashBalance, setCashBalance] = useState({ opening_balance: 0, cash_income: 0, cash_expense: 0, expected_balance: 0, last_reconciliation: null });
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashForm, setCashForm] = useState(emptyCashForm);
  const [cashPreview, setCashPreview] = useState(cashBalance);
  const [addonSaleOpen, setAddonSaleOpen] = useState(false);
  const user = getStoredUser();
  const canEdit = canManageFinance(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const { items: subscriptions } = useLookup('subscriptions/', { client: form.client || '' }, { enabled: Boolean(form.client) });
  const subscriptionOptions = subscriptions.map((item) => ({ value: String(item.id), label: subscriptionLabel(item) }));

  useEffect(() => {
    api.get('finance/summary/', { params: crud.filters }).then(({ data }) => setSummary(data));
  }, [crud.filters, crud.items]);

  const loadCashBalance = async (branch = crud.filters.branch || 'all') => {
    const { data } = await api.get('finance/cash-balance/', { params: { branch } });
    setCashBalance(data);
    return data;
  };

  useEffect(() => {
    loadCashBalance(crud.filters.branch || 'all');
  }, [crud.filters.branch, crud.items]);

  useEffect(() => {
    if (!cashModalOpen) return;
    api.get('finance/cash-balance/', { params: { branch: cashForm.branch || 'unassigned' } }).then(({ data }) => setCashPreview(data));
  }, [cashModalOpen, cashForm.branch]);

  const currentInactiveMethod = form.payment_method && !paymentOptions.some((item) => item.value === String(form.payment_method))
    ? [{ value: String(form.payment_method), label: form.payment_method_name || 'Отключённый способ' }]
    : [];
  const fields = [
    { name: 'transaction_type', label: 'Тип', type: 'select', options: [{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }] },
    { name: 'amount', label: 'Сумма', type: 'number' },
    { name: 'source', label: 'Источник', type: 'select', options: sourceOptions },
    { name: 'payment_parts', type: 'custom', render: (current, update) => <PaymentSplitFields totalAmount={current.amount} value={current.payment_parts} onChange={(payment_parts) => update({ ...current, payment_parts })} /> },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Автоматически' }, ...branchOptions] },
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Без клиента' },
    { name: 'subscription', label: 'Абонемент', type: 'select', options: [{ value: '', label: form.client ? 'Без абонемента' : 'Сначала выберите клиента' }, ...subscriptionOptions] },
    { name: 'paid_at', label: 'Дата операции', type: 'datetime-local' },
    { name: 'comment', label: 'Комментарий', type: 'textarea' },
  ];

  const editTransaction = (row) => {
    const { type, ...editable } = row;
    crud.setEditing({ ...editable, transaction_type: row.transaction_type ?? type, payment_method: row.payment_method ? String(row.payment_method) : '', payment_parts: partsFromTransaction(row) });
    crud.setModalOpen(true);
  };
  const resetFilters = () => crud.setFilters(emptyFilters);
  const refreshFinance = async () => {
    await crud.reload();
    const { data } = await api.get('finance/summary/', { params: crud.filters });
    setSummary(data);
    await loadCashBalance(crud.filters.branch || 'all');
  };
  const openCashReconcile = () => {
    const branch = crud.filters.branch && crud.filters.branch !== 'all' && crud.filters.branch !== 'unassigned' ? crud.filters.branch : '';
    setCashForm({ ...emptyCashForm, branch });
    setCashPreview(cashBalance);
    setCashModalOpen(true);
  };
  const saveCashReconcile = async () => {
    const { data } = await api.post('finance/cash-balance/reconcile/', {
      branch: cashForm.branch || null,
      amount: cashForm.amount,
      comment: cashForm.comment,
    });
    setCashBalance(data);
    setCashModalOpen(false);
  };
  const saveTransaction = async () => {
    if (Number(form.amount || 0) > 0 && paymentPartsTotal(form.payment_parts) !== Number(form.amount || 0)) {
      dispatchError('Сумма оплат по способам должна совпадать с суммой операции.');
      return;
    }
    await crud.save({ ...form, payment_parts: paymentPartsPayload(form.payment_parts) });
  };
  const cashDifference = Number(cashForm.amount || 0) - Number(cashPreview.expected_balance || 0);

  return (
    <>
      <PageHeader title="Финансы" actionLabel="Добавить операцию" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        {canEdit && (
          <Button variant="secondary" onClick={() => setAddonSaleOpen(true)}>
            <ShoppingCart size={17} />
            Продать товар / услугу
          </Button>
        )}
      </PageHeader>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Доход', summary.income, 'text-emerald-700'], ['Расход', summary.expense, 'text-red-700'],
          ['Баланс', summary.balance, 'text-brand'], ['Операций', summary.transactions_count, 'text-slate-900'],
          ['Средний доходный чек', summary.average_income, 'text-slate-900'],
        ].map(([label, value, tone], index) => <div key={label} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-card"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-2 text-xl font-bold ${tone}`}>{index === 3 ? value : money(value)}</p></div>)}
      </section>
      <section className="mb-5 rounded-[24px] border border-emerald-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">Наличные в кассе</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{money(cashBalance.expected_balance)}</p>
            <p className="mt-1 text-sm text-slate-500">
              Последняя сверка: {cashBalance.last_reconciliation?.recorded_at ? new Date(cashBalance.last_reconciliation.recorded_at).toLocaleString('ru-RU') : 'не было'}
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-slate-500">База</p>
              <p className="font-bold text-slate-900">{money(cashBalance.opening_balance)}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-emerald-700">Наличные доходы после сверки</p>
              <p className="font-bold text-emerald-800">{money(cashBalance.cash_income)}</p>
            </div>
            <div className="rounded-2xl bg-red-50 p-3">
              <p className="text-red-700">Наличные расходы после сверки</p>
              <p className="font-bold text-red-800">{money(cashBalance.cash_expense)}</p>
            </div>
          </div>
          {canEdit && <Button variant="secondary" onClick={openCashReconcile}>Сверить кассу</Button>}
        </div>
      </section>
      <Filters>
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(event) => crud.setFilters({ ...crud.filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(event) => crud.setFilters({ ...crud.filters, date_to: event.target.value })} />
        <SelectField label="Филиал" value={crud.filters.branch} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <SelectField label="Тип" value={crud.filters.transaction_type} onChange={(value) => crud.setFilters({ ...crud.filters, transaction_type: value })} options={[{ value: '', label: 'Все операции' }, { value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }]} />
        <SelectField label={'\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a'} value={crud.filters.source} onChange={(value) => crud.setFilters({ ...crud.filters, source: value })} options={[{ value: '', label: '\u0412\u0441\u0435 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438' }, ...sourceOptions]} />
        <SelectField label="Способ оплаты" value={crud.filters.payment_method} onChange={(value) => crud.setFilters({ ...crud.filters, payment_method: value })} options={[{ value: 'all', label: 'Все способы' }, ...paymentOptions, { value: 'unassigned', label: 'Не указан' }]} />
        <SelectField label="Скидка" value={crud.filters.discount} onChange={(value) => crud.setFilters({ ...crud.filters, discount: value })} options={[{ value: 'all', label: 'Все скидки' }, ...discountOptions, { value: 'unassigned', label: 'Без скидки' }]} />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: 'all', label: 'Все менеджеры' }, ...managerOptions, { value: 'unassigned', label: 'Не указан' }]} />
        <SelectField label="Клиент" value={crud.filters.client} onChange={(value) => crud.setFilters({ ...crud.filters, client: value })} options={[{ value: '', label: 'Все клиенты' }, ...clientOptions]} />
        <Input label="Поиск" value={crud.filters.search} onChange={(event) => crud.setFilters({ ...crud.filters, search: event.target.value })} />
        <div className="flex items-end"><Button variant="secondary" onClick={resetFilters}>Сбросить фильтры</Button></div>
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'paid_at', header: 'Дата', render: (row) => row.paid_at ? new Date(row.paid_at).toLocaleString('ru-RU') : '—' },
        { key: 'type', header: 'Тип', render: (row) => <Badge value={row.transaction_type}>{typeLabel(row.transaction_type)}</Badge> },
        { key: 'amount', header: 'Сумма', render: (row) => (
          <div className="text-sm">
            <p>{money(row.subtotal_amount || row.amount)}</p>
            {Number(row.discount_amount || 0) > 0 && <p className="text-emerald-700">Скидка: −{money(row.discount_amount)}</p>}
            <p className="font-bold">Оплачено: {money(row.amount)}</p>
          </div>
        ) },
        { key: 'payment_method_name', header: 'Оплата', render: (row) => row.payment_parts?.length ? (
          <div className="text-sm">
            {row.payment_parts.length > 1 && <Badge value="mixed">Смешанная оплата</Badge>}
            {row.payment_parts.map((part) => <p key={part.id || part.payment_method}>{part.payment_method_name} — {money(part.amount)}</p>)}
          </div>
        ) : (row.payment_method_name || 'Не указан') },
        { key: 'client', header: 'Клиент', render: (row) => row.client_name || 'Не указан' },
        { key: 'source', header: 'Назначение', render: (row) => sourceLabel(row.source) },
        { key: 'addon_sale_summary', header: 'Состав', render: (row) => ['addon', 'product', 'retail'].includes(row.source) ? (row.addon_sale_summary || row.comment || '—') : '—' },
        { key: 'created_by', header: 'Менеджер', render: (row) => row.created_by_name || 'Не указан' },
        { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
        { key: 'comment', header: 'Комментарий', render: (row) => row.comment || '—' },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => editTransaction(row)} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      {!paymentOptions.length && <p className="mt-3 text-sm text-amber-700">Способы оплаты не добавлены. Добавьте их в Настройки → Способы оплаты.</p>}
      <CrudModal title="Финансовая операция" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={saveTransaction} />
      <AddonSaleModal open={addonSaleOpen} onClose={() => setAddonSaleOpen(false)} onSaved={refreshFinance} />
      <Modal
        title="Сверить кассу"
        open={cashModalOpen}
        onClose={() => setCashModalOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setCashModalOpen(false)}>Отмена</Button><Button onClick={saveCashReconcile}>Сохранить сверку</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Филиал" value={cashForm.branch} onChange={(value) => setCashForm({ ...cashForm, branch: value })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
          <Input label="Фактическая сумма" type="number" value={cashForm.amount} onChange={(event) => setCashForm({ ...cashForm, amount: event.target.value })} />
          <Input label="Комментарий" className="md:col-span-2" value={cashForm.comment} onChange={(event) => setCashForm({ ...cashForm, comment: event.target.value })} />
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Рассчитано системой</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{money(cashPreview.expected_balance)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Разница</p>
            <p className={`mt-1 text-xl font-bold ${cashDifference === 0 ? 'text-slate-900' : cashDifference > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(cashDifference)}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
