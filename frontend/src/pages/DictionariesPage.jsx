import { useState } from 'react';

import api from '../api/axios.js';
import { getStoredUser, hasRole, ROLES } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, Table, dateOnly, showApiError, useCrudResource } from './pageUtils.jsx';

const statusOptions = [
  { value: '', label: 'Все' },
  { value: 'true', label: 'Активные' },
  { value: 'false', label: 'Неактивные' },
];

const activeField = {
  name: 'is_active',
  label: 'Активен',
  type: 'select',
  options: [
    { value: true, label: 'Да' },
    { value: false, label: 'Нет' },
  ],
};

const emptySubject = {
  name: '',
  description: '',
  is_active: true,
};

const emptyRoom = {
  name: '',
  capacity: '',
  description: '',
  is_active: true,
};

const subjectFields = [
  { name: 'name', label: 'Название' },
  { name: 'description', label: 'Описание', type: 'textarea' },
  activeField,
];

const roomFields = [
  { name: 'name', label: 'Название' },
  { name: 'capacity', label: 'Вместимость', type: 'number' },
  { name: 'description', label: 'Описание', type: 'textarea' },
  activeField,
];

function DictionarySection({ type }) {
  const isSubjects = type === 'subjects';
  const endpoint = isSubjects ? 'subjects/' : 'rooms/';
  const emptyItem = isSubjects ? emptySubject : emptyRoom;
  const fields = isSubjects ? subjectFields : roomFields;
  const crud = useCrudResource(endpoint, { search: '', is_active: '' });
  const user = getStoredUser();
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);

  const toggleActive = async (row) => {
    try {
      await api.patch(`${endpoint}${row.id}/`, { is_active: !row.is_active });
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader
        title={isSubjects ? 'Предметы' : 'Кабинеты'}
        actionLabel={isSubjects ? 'Добавить предмет' : 'Добавить кабинет'}
        onAction={canEdit ? () => { crud.setEditing(emptyItem); crud.setModalOpen(true); } : undefined}
      />

      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(event) => crud.setFilters({ ...crud.filters, search: event.target.value })} />
        <SelectField label="Статус" value={crud.filters.is_active} onChange={(value) => crud.setFilters({ ...crud.filters, is_active: value })} options={statusOptions} />
      </Filters>

      <Table
        data={crud.items}
        empty={isSubjects ? 'Предметов пока нет' : 'Кабинетов пока нет'}
        columns={[
          { key: 'name', header: 'Название' },
          ...(isSubjects ? [] : [{ key: 'capacity', header: 'Вместимость', render: (row) => row.capacity || '-' }]),
          { key: 'description', header: 'Описание' },
          {
            key: 'is_active',
            header: 'Активен',
            render: (row) => (
              <button type="button" onClick={() => canEdit && toggleActive(row)} className="inline-flex">
                <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Да' : 'Нет'}</Badge>
              </button>
            ),
          },
          { key: 'created_at', header: 'Дата создания', render: (row) => dateOnly(row.created_at) },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <Actions
                canEdit={canEdit}
                canDelete={canEdit}
                onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }}
                onDelete={() => crud.remove(row.id)}
              />
            ),
          },
        ]}
      />

      <CrudModal
        title={isSubjects ? 'Предмет' : 'Кабинет'}
        open={crud.modalOpen}
        onClose={() => crud.setModalOpen(false)}
        fields={fields}
        form={crud.editing || emptyItem}
        setForm={crud.setEditing}
        saving={crud.saving}
        onSubmit={() => crud.save(crud.editing || emptyItem)}
      />
    </>
  );
}

export default function DictionariesPage() {
  const [tab, setTab] = useState('subjects');

  return (
    <>
      <PageHeader title="Справочники">
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'subjects' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('subjects')}>
            Предметы
          </button>
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'rooms' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('rooms')}>
            Кабинеты
          </button>
        </div>
      </PageHeader>

      <DictionarySection type={tab} />
    </>
  );
}
