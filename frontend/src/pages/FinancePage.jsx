import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';
import { canDeleteDangerous, canManageFinance, getStoredUser } from '../auth.js';
import { subscriptionLabel, useClientOptions, useLookup } from './lookupUtils.jsx';

const empty = { type: 'income', amount: 0, source: '', payment_method: '', client: '', subscription: '', paid_at: '', comment: '' };
const sourceOptions = [
  { value: 'subscription', label: 'Абонемент' },
  { value: 'trial', label: 'Пробник' },
  { value: 'master_class', label: 'МК' },
  { value: 'manual', label: 'Ручная операция' },
  { value: 'salary', label: 'Зарплата' },
  { value: 'rent', label: 'Аренда' },
  { value: 'other', label: 'Другое' },
];
const baseFields = [
  { name: 'type', label: 'Тип', type: 'select', options: [{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }] },
  { name: 'amount', label: 'Сумма', type: 'number' },
  { name: 'source', label: 'Источник', type: 'select', options: sourceOptions },
  { name: 'payment_method', label: 'Способ оплаты' },
  { name: 'paid_at', label: 'Дата операции', type: 'datetime-local' },
  { name: 'comment', label: 'Описание', type: 'textarea' },
];

export default function FinancePage() {
  const crud = useCrudResource('finance/', { type: '', source: '', payment_method: '', date_from: '', date_to: '' });
  const { clientOptions } = useClientOptions();
  const user = getStoredUser();
  const canEdit = canManageFinance(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const { items: subscriptions } = useLookup('subscriptions/', { client: form.client || '' }, { enabled: Boolean(form.client) });
  const subscriptionOptions = subscriptions.map((subscription) => ({ value: String(subscription.id), label: subscriptionLabel(subscription) }));
  const fields = [
    baseFields[0],
    baseFields[1],
    baseFields[2],
    baseFields[3],
    { name: 'client', label: 'Клиент', type: 'select', options: [{ value: '', label: 'Без клиента' }, ...clientOptions] },
    { name: 'subscription', label: 'Абонемент', type: 'select', options: [{ value: '', label: form.client ? 'Без абонемента' : 'Сначала выберите клиента' }, ...subscriptionOptions] },
    baseFields[4],
    baseFields[5],
  ];
  const transactionType = (item) => item.type ?? item.transaction_type;
  const income = crud.items.filter((item) => transactionType(item) === 'income').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = crud.items.filter((item) => transactionType(item) === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const editTransaction = (row) => {
    const { transaction_type, ...editableRow } = row;
    crud.setEditing({ ...editableRow, type: row.type ?? transaction_type });
    crud.setModalOpen(true);
  };

  return (
    <>
      <PageHeader title="Финансы" actionLabel="Добавить операцию" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Доход: {money(income)}</span>
        <span className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Расход: {money(expense)}</span>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Баланс: {money(income - expense)}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Тип" value={crud.filters.type} onChange={(value) => crud.setFilters({ ...crud.filters, type: value })} options={[{ value: '', label: 'Все' }, { value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }]} />
        <SelectField label="Источник" value={crud.filters.source} onChange={(value) => crud.setFilters({ ...crud.filters, source: value })} options={[{ value: '', label: 'Все' }, ...sourceOptions]} />
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(e) => crud.setFilters({ ...crud.filters, date_from: e.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(e) => crud.setFilters({ ...crud.filters, date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'type', header: 'Тип', render: (row) => <Badge value={transactionType(row)} /> },
        { key: 'client', header: 'Клиент', render: (row) => row.client_name || '—' },
        { key: 'amount', header: 'Сумма', render: (row) => money(row.amount) },
        { key: 'source', header: 'Источник' },
        { key: 'payment_method', header: 'Оплата' },
        { key: 'created_by', header: 'Создал', render: (row) => row.created_by_name || '—' },
        { key: 'paid_at', header: 'Дата', render: (row) => (row.paid_at ? new Date(row.paid_at).toLocaleString('ru-RU') : '—') },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => editTransaction(row)} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Операция" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
