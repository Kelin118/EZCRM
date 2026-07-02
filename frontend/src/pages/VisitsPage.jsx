import { Link } from 'react-router-dom';

import { Actions, Badge, CrudModal, Filters, Input, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const empty = {
  client: '',
  subscription: '',
  teacher: '',
  visited_at: '',
  status: 'attended',
  notes: '',
};

export const visitStatusOptions = [
  { value: 'attended', label: 'Пришел' },
  { value: 'missed', label: 'Не пришел' },
  { value: 'makeup', label: 'Отработка' },
  { value: 'frozen', label: 'Заморозка' },
  { value: 'trial', label: 'Пробное' },
];

const fields = [
  { name: 'client', label: 'ID клиента', type: 'number' },
  { name: 'subscription', label: 'ID абонемента', type: 'number' },
  { name: 'teacher', label: 'ID преподавателя', type: 'number' },
  { name: 'visited_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'status', label: 'Статус', type: 'select', options: visitStatusOptions },
  { name: 'notes', label: 'Комментарий', type: 'textarea' },
];

export default function VisitsPage() {
  const crud = useCrudResource('visits/', { client: '', date: '' });
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);

  return (
    <>
      <PageHeader title="Посещения" actionLabel="Добавить посещение" onAction={() => { crud.setEditing(empty); crud.setModalOpen(true); }} />
      <Filters>
        <Input label="ID клиента" value={crud.filters.client} onChange={(e) => crud.setFilters({ ...crud.filters, client: e.target.value })} />
        <Input label="Дата" type="date" value={crud.filters.date} onChange={(e) => crud.setFilters({ ...crud.filters, date: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'client', header: 'Клиент', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || `#${row.client}`}</Link> },
        { key: 'subscription', header: 'Абонемент ID' },
        { key: 'visited_at', header: 'Дата', render: (row) => (row.visited_at ? new Date(row.visited_at).toLocaleString('ru-RU') : '—') },
        { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{visitStatusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
        { key: 'lesson_deducted', header: 'Списано', render: (row) => (row.lesson_deducted ? 'Да' : 'Нет') },
        { key: 'notes', header: 'Комментарий' },
        { key: 'actions', header: '', render: (row) => <Actions onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Посещение" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
