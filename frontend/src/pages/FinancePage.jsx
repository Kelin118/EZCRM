import { ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageFinance, getStoredUser } from '../auth.js';
import AddonSaleModal from '../components/sales/AddonSaleModal.jsx';
import useBranches from '../hooks/useBranches.js';
import useDiscounts from '../hooks/useDiscounts.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';
import { subscriptionLabel, useClientOptions, useEmployeeOptions, useLookup } from './lookupUtils.jsx';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const empty = { transaction_type: 'income', amount: 0, source: 'manual', payment_method: '', client: '', subscription: '', paid_at: '', comment: '', branch: '' };
const emptyFilters = { transaction_type: '', source: '', payment_method: 'all', discount: 'all', manager: 'all', client: '', search: '', date_from: '', date_to: '', branch: 'all' };
const sourceOptions = [
  { value: 'subscription', label: 'Абонемент' }, { value: 'trial', label: 'Пробник' },
  { value: 'master_class', label: 'Мастер-класс' }, { value: 'addon', label: 'Дополнительные услуги' },
  { value: 'product', label: '\u0422\u043e\u0432\u0430\u0440' }, { value: 'retail', label: '\u0422\u043e\u0432\u0430\u0440\u044b \u0438 \u0443\u0441\u043b\u0443\u0433\u0438' },
  { value: 'manual', label: 'Ручная операция' }, { value: 'salary', label: 'Зарплата' },
  { value: 'rent', label: 'Аренда' }, { value: 'other', label: 'Другое' },
];
const sourceLabel = (value) => sourceOptions.find((item) => item.value === value)?.label || value || 'Другое';
const typeLabel = (value) => (value === 'income' ? 'Доход' : value === 'expense' ? 'Расход' : value);

export default function FinancePage() {
  const crud = useCrudResource('finance/', emptyFilters);
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentOptions } = usePaymentMethods({ activeOnly: true });
  const { options: discountOptions } = useDiscounts({ branch: crud.filters.branch });
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const [summary, setSummary] = useState({ income: 0, expense: 0, balance: 0, transactions_count: 0, average_income: 0 });
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

  const currentInactiveMethod = form.payment_method && !paymentOptions.some((item) => item.value === String(form.payment_method))
    ? [{ value: String(form.payment_method), label: form.payment_method_name || 'Отключённый способ' }]
    : [];
  const fields = [
    { name: 'transaction_type', label: 'Тип', type: 'select', options: [{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }] },
    { name: 'amount', label: 'Сумма', type: 'number' },
    { name: 'source', label: 'Источник', type: 'select', options: sourceOptions },
    { name: 'payment_method', label: 'Способ оплаты', type: 'select', options: [{ value: '', label: 'Выберите способ' }, ...currentInactiveMethod, ...paymentOptions] },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Автоматически' }, ...branchOptions] },
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Без клиента' },
    { name: 'subscription', label: 'Абонемент', type: 'select', options: [{ value: '', label: form.client ? 'Без абонемента' : 'Сначала выберите клиента' }, ...subscriptionOptions] },
    { name: 'paid_at', label: 'Дата операции', type: 'datetime-local' },
    { name: 'comment', label: 'Комментарий', type: 'textarea' },
  ];

  const editTransaction = (row) => {
    const { type, ...editable } = row;
    crud.setEditing({ ...editable, transaction_type: row.transaction_type ?? type, payment_method: row.payment_method ? String(row.payment_method) : '' });
    crud.setModalOpen(true);
  };
  const resetFilters = () => crud.setFilters(emptyFilters);
  const refreshFinance = async () => {
    await crud.reload();
    const { data } = await api.get('finance/summary/', { params: crud.filters });
    setSummary(data);
  };

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
        { key: 'payment_method_name', header: 'Способ оплаты', render: (row) => row.payment_method_name || 'Не указан' },
        { key: 'client', header: 'Клиент', render: (row) => row.client_name || 'Не указан' },
        { key: 'source', header: 'Назначение', render: (row) => sourceLabel(row.source) },
        { key: 'addon_sale_summary', header: 'Состав', render: (row) => ['addon', 'product', 'retail'].includes(row.source) ? (row.addon_sale_summary || row.comment || '—') : '—' },
        { key: 'created_by', header: 'Менеджер', render: (row) => row.created_by_name || 'Не указан' },
        { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
        { key: 'comment', header: 'Комментарий', render: (row) => row.comment || '—' },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => editTransaction(row)} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      {!paymentOptions.length && <p className="mt-3 text-sm text-amber-700">Способы оплаты не добавлены. Добавьте их в Настройки → Способы оплаты.</p>}
      <CrudModal title="Финансовая операция" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
      <AddonSaleModal open={addonSaleOpen} onClose={() => setAddonSaleOpen(false)} onSaved={refreshFinance} />
    </>
  );
}
