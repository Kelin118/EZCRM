import { Link } from 'react-router-dom';

import { canDeleteDangerous, canManageClients, getStoredUser } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const emptyClient = {
  first_name: '',
  last_name: '',
  parent_name: '',
  phone: '',
  email: '',
  birth_date: '',
  school_class: '',
  direction: '',
  manager: '',
  notes: '',
  is_active: true,
};

const baseFields = [
  { name: 'first_name', label: 'Имя' },
  { name: 'last_name', label: 'Фамилия' },
  { name: 'parent_name', label: 'Родитель' },
  { name: 'phone', label: 'Телефон' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'birth_date', label: 'Дата рождения', type: 'date' },
  { name: 'school_class', label: 'Класс' },
  { name: 'direction', label: 'Направление' },
  {
    name: 'is_active',
    label: 'Статус',
    type: 'select',
    options: [
      { value: true, label: 'Активен' },
      { value: false, label: 'Неактивен' },
    ],
  },
  { name: 'notes', label: 'Комментарий', type: 'textarea' },
];

export default function ClientsPage() {
  const crud = useCrudResource('clients/', { search: '', status: '', manager: '' });
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);
  const user = getStoredUser();
  const canEdit = canManageClients(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || emptyClient;
  const setForm = (value) => crud.setEditing(value);
  const fields = [
    ...baseFields.slice(0, 8),
    { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
    ...baseFields.slice(8),
  ];

  return (
    <>
      <PageHeader title="Клиенты" actionLabel="Добавить клиента" onAction={canEdit ? () => { crud.setEditing(emptyClient); crud.setModalOpen(true); } : undefined} />
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField
          label="Статус"
          value={crud.filters.status}
          onChange={(value) => crud.setFilters({ ...crud.filters, status: value })}
          options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Неактивные' }]}
        />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
      </Filters>
      <Table
        data={crud.items}
        columns={[
          {
            key: 'name',
            header: 'Клиент',
            render: (row) => (
              <Link className="font-medium text-brand hover:underline" to={`/clients/${row.id}`}>
                {`${row.first_name || ''} ${row.last_name || ''}`.trim() || `Клиент #${row.id}`}
              </Link>
            ),
          },
          { key: 'parent_name', header: 'Родитель' },
          { key: 'phone', header: 'Телефон' },
          { key: 'school_class', header: 'Класс' },
          { key: 'direction', header: 'Направление' },
          { key: 'is_active', header: 'Статус', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Активен' : 'Неактивен'}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex gap-2">
                <Link to={`/clients/${row.id}`}>
                  <Button variant="secondary">Открыть</Button>
                </Link>
                <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} />
              </div>
            ),
          },
        ]}
      />
      <CrudModal title="Клиент" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
