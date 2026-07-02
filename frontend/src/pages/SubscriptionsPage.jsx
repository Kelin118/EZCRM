import { Link } from 'react-router-dom';

import { canDeleteDangerous, canManageSubscriptions, getStoredUser } from '../auth.js';
import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const empty = {
  client: '',
  title: '',
  start_date: '',
  end_date: '',
  total_visits: 0,
  remaining_visits: 0,
  price: 0,
  paid_amount: 0,
  purchase_date: '',
  status: 'active',
};

const fields = [
  { name: 'client', label: 'ID клиента', type: 'number' },
  { name: 'title', label: 'Название' },
  { name: 'start_date', label: 'Дата начала', type: 'date' },
  { name: 'end_date', label: 'Дата окончания', type: 'date' },
  { name: 'purchase_date', label: 'Дата покупки', type: 'date' },
  { name: 'total_visits', label: 'Всего занятий', type: 'number' },
  { name: 'remaining_visits', label: 'Осталось занятий', type: 'number' },
  { name: 'price', label: 'Стоимость', type: 'number' },
  { name: 'paid_amount', label: 'Оплачено', type: 'number' },
  {
    name: 'status',
    label: 'Статус',
    type: 'select',
    options: [
      { value: 'active', label: 'Активен' },
      { value: 'paused', label: 'Пауза' },
      { value: 'expired', label: 'Истёк' },
      { value: 'cancelled', label: 'Отменён' },
    ],
  },
];

function Progress({ row }) {
  const total = Number(row.lessons_total ?? row.total_visits ?? 0);
  const left = Number(row.lessons_left ?? row.remaining_visits ?? 0);
  const used = Number(row.used_lessons ?? Math.max(total - left, 0));
  const percent = total ? Math.min((used / total) * 100, 100) : 0;

  return (
    <div className="w-44">
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Использовано {used} из {total}, осталось {left}</p>
    </div>
  );
}

export default function SubscriptionsPage() {
  const crud = useCrudResource('subscriptions/', { status: '', client: '', date_from: '', date_to: '' });
  const user = getStoredUser();
  const canEdit = canManageSubscriptions(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const totalPaid = crud.items.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);

  return (
    <>
      <PageHeader title="Абонементы" actionLabel="Добавить абонемент" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено за период: {money(totalPaid)}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'paused', label: 'Пауза' }, { value: 'expired', label: 'Истёк' }, { value: 'cancelled', label: 'Отменён' }]} />
        <Input label="ID клиента" value={crud.filters.client} onChange={(e) => crud.setFilters({ ...crud.filters, client: e.target.value })} />
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(e) => crud.setFilters({ ...crud.filters, date_from: e.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(e) => crud.setFilters({ ...crud.filters, date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'title', header: 'Название' },
        { key: 'client', header: 'Клиент', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || `#${row.client}`}</Link> },
        { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status} /> },
        { key: 'lessons_total', header: 'Всего', render: (row) => row.lessons_total ?? row.total_visits },
        { key: 'used_lessons', header: 'Использовано' },
        { key: 'lessons_left', header: 'Осталось', render: (row) => row.lessons_left ?? row.remaining_visits },
        { key: 'progress', header: 'Прогресс', render: (row) => <Progress row={row} /> },
        { key: 'paid_amount', header: 'Оплачено', render: (row) => money(row.paid_amount) },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Абонемент" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
