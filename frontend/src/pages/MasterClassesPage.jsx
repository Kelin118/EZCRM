import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';
import { canDeleteDangerous, canManageSales, getStoredUser } from '../auth.js';

const empty = {
  title: '',
  client: '',
  description: '',
  manager: '',
  teacher: '',
  starts_at: '',
  stage: 'planned',
  payment_date: '',
  capacity: 0,
  price: 0,
  payment_amount: 0,
  participants: [],
};

const fields = [
  { name: 'title', label: 'Название' },
  { name: 'client', label: 'ID клиента', type: 'number' },
  { name: 'manager', label: 'ID менеджера', type: 'number' },
  { name: 'teacher', label: 'ID преподавателя', type: 'number' },
  { name: 'starts_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'stage', label: 'Этап', type: 'select', options: [{ value: 'planned', label: 'Планируется' }, { value: 'completed', label: 'Завершён' }, { value: 'cancelled', label: 'Отменён' }] },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'capacity', label: 'Мест', type: 'number' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'payment_amount', label: 'Оплачено', type: 'number' },
  { name: 'description', label: 'Описание', type: 'textarea' },
];

export default function MasterClassesPage() {
  const crud = useCrudResource('master-classes/', { stage: '', manager: '', payment_date_from: '', payment_date_to: '' });
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const total = crud.items.reduce((sum, item) => sum + Number(item.payment_amount || 0), 0);

  return (
    <>
      <PageHeader title="Мастер-классы" actionLabel="Добавить МК" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено: {money(total)}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, { value: 'planned', label: 'Планируется' }, { value: 'completed', label: 'Завершён' }, { value: 'cancelled', label: 'Отменён' }]} />
        <Input label="ID менеджера" value={crud.filters.manager} onChange={(e) => crud.setFilters({ ...crud.filters, manager: e.target.value })} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'title', header: 'Название' },
        { key: 'starts_at', header: 'Дата', render: (row) => (row.starts_at ? new Date(row.starts_at).toLocaleString('ru-RU') : '—') },
        { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage} /> },
        { key: 'capacity', header: 'Мест' },
        { key: 'price', header: 'Цена', render: (row) => money(row.price) },
        { key: 'payment_amount', header: 'Оплачено', render: (row) => money(row.payment_amount) },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Мастер-класс" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
