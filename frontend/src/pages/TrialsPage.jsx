import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const empty = { client: '', manager: '', teacher: '', scheduled_at: '', status: 'new', payment_date: '', price: 0, bought_subscription: false, notes: '' };
const fields = [
  { name: 'client', label: 'ID клиента', type: 'number' },
  { name: 'manager', label: 'ID менеджера', type: 'number' },
  { name: 'teacher', label: 'ID преподавателя', type: 'number' },
  { name: 'scheduled_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'status', label: 'Этап', type: 'select', options: [{ value: 'new', label: 'Новый' }, { value: 'scheduled', label: 'Запланирован' }, { value: 'completed', label: 'Завершён' }, { value: 'cancelled', label: 'Отменён' }] },
  { name: 'bought_subscription', label: 'Купил абонемент', type: 'select', options: [{ value: false, label: 'Нет' }, { value: true, label: 'Да' }] },
  { name: 'notes', label: 'Заметки', type: 'textarea' },
];

export default function TrialsPage() {
  const crud = useCrudResource('trials/', { stage: '', manager: '', payment_date_from: '', payment_date_to: '' });
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const total = crud.items.reduce((sum, item) => sum + Number(item.price || 0), 0);

  return (
    <>
      <PageHeader title="Пробники" actionLabel="Добавить пробник" onAction={() => { crud.setEditing(empty); crud.setModalOpen(true); }}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Итого: {money(total)}</span>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Купили: {crud.items.filter((item) => item.bought_subscription).length}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, { value: 'new', label: 'Новый' }, { value: 'scheduled', label: 'Запланирован' }, { value: 'completed', label: 'Завершён' }]} />
        <Input label="ID менеджера" value={crud.filters.manager} onChange={(e) => crud.setFilters({ ...crud.filters, manager: e.target.value })} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'client', header: 'Клиент ID' },
        { key: 'scheduled_at', header: 'Дата' },
        { key: 'status', header: 'Этап', render: (row) => <Badge value={row.status} /> },
        { key: 'payment_date', header: 'Оплата' },
        { key: 'price', header: 'Сумма', render: (row) => money(row.price) },
        { key: 'bought_subscription', header: 'Купил', render: (row) => (row.bought_subscription ? 'Да' : 'Нет') },
        { key: 'actions', header: '', render: (row) => <Actions onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Пробник" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
