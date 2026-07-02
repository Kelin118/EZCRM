import { Actions, CrudModal, Filters, Input, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';

const emptyClient = { first_name: '', last_name: '', phone: '', email: '', birth_date: '', notes: '', is_active: true };
const fields = [
  { name: 'first_name', label: 'Имя' },
  { name: 'last_name', label: 'Фамилия' },
  { name: 'phone', label: 'Телефон' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'birth_date', label: 'Дата рождения', type: 'date' },
  {
    name: 'is_active',
    label: 'Статус',
    type: 'select',
    options: [
      { value: true, label: 'Активен' },
      { value: false, label: 'Неактивен' },
    ],
  },
  { name: 'notes', label: 'Заметки', type: 'textarea' },
];

export default function ClientsPage() {
  const crud = useCrudResource('clients/', { search: '', status: '', manager: '' });
  const form = crud.editing || emptyClient;
  const setForm = (value) => crud.setEditing(value);

  return (
    <>
      <PageHeader title="Клиенты" actionLabel="Добавить клиента" onAction={() => { crud.setEditing(emptyClient); crud.setModalOpen(true); }} />
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField
          label="Статус"
          value={crud.filters.status}
          onChange={(value) => crud.setFilters({ ...crud.filters, status: value })}
          options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Неактивные' }]}
        />
        <Input label="ID менеджера" value={crud.filters.manager} onChange={(e) => crud.setFilters({ ...crud.filters, manager: e.target.value })} />
      </Filters>
      <Table
        data={crud.items}
        columns={[
          { key: 'name', header: 'Клиент', render: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() },
          { key: 'phone', header: 'Телефон' },
          { key: 'email', header: 'Email' },
          { key: 'is_active', header: 'Статус', render: (row) => (row.is_active ? 'Активен' : 'Неактивен') },
          { key: 'actions', header: '', render: (row) => <Actions onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
        ]}
      />
      <CrudModal title="Клиент" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
