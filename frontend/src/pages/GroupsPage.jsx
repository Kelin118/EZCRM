import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Modal from '../components/ui/Modal.jsx';
import { canDeleteDangerous, hasRole, ROLES, getStoredUser } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, Table, useCrudResource, showApiError } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions, useSubjectOptions } from './lookupUtils.jsx';

const emptyGroup = {
  name: '',
  subject: '',
  teacher: '',
  manager: '',
  start_date: '',
  end_date: '',
  status: 'active',
  description: '',
};

const statusOptions = [
  { value: '', label: 'Все' },
  { value: 'active', label: 'Активная' },
  { value: 'paused', label: 'На паузе' },
  { value: 'archived', label: 'Архив' },
];

const memberStatusOptions = [
  { value: 'active', label: 'Активен' },
  { value: 'paused', label: 'На паузе' },
  { value: 'left', label: 'Ушёл' },
];

export default function GroupsPage() {
  const crud = useCrudResource('study-groups/', { search: '', status: '', teacher: '', subject: '' });
  const { subjectOptions } = useSubjectOptions();
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const { clientOptions } = useClientOptions();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberForm, setMemberForm] = useState({ client: '', status: 'active', note: '' });
  const user = getStoredUser();
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || emptyGroup;

  const groupFields = useMemo(
    () => [
      { name: 'name', label: 'Название' },
      { name: 'subject', label: 'Предмет', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...subjectOptions] },
      { name: 'teacher', label: 'Учитель', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
      { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
      { name: 'start_date', label: 'Дата начала', type: 'date' },
      { name: 'end_date', label: 'Дата окончания', type: 'date' },
      { name: 'status', label: 'Статус', type: 'select', options: statusOptions.filter((item) => item.value) },
      { name: 'description', label: 'Описание', type: 'textarea' },
    ],
    [subjectOptions, teacherOptions, managerOptions],
  );

  const loadMembers = async (group) => {
    const { data } = await api.get('group-memberships/', { params: { group: group.id } });
    setMembers(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    if (selectedGroup) loadMembers(selectedGroup);
  }, [selectedGroup?.id]);

  const addMember = async () => {
    if (!selectedGroup || !memberForm.client) return;
    try {
      await api.post('group-memberships/', { ...memberForm, group: selectedGroup.id });
      setMemberForm({ client: '', status: 'active', note: '' });
      await loadMembers(selectedGroup);
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const updateMember = async (member, status) => {
    try {
      await api.patch(`group-memberships/${member.id}/`, { status });
      await loadMembers(selectedGroup);
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const removeMember = async (member) => {
    try {
      await api.delete(`group-memberships/${member.id}/`);
      await loadMembers(selectedGroup);
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader
        title="Группы"
        actionLabel="Добавить группу"
        onAction={canEdit ? () => { crud.setEditing(emptyGroup); crud.setModalOpen(true); } : undefined}
      />

      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(event) => crud.setFilters({ ...crud.filters, search: event.target.value })} />
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={statusOptions} />
        <SelectField label="Учитель" value={crud.filters.teacher} onChange={(value) => crud.setFilters({ ...crud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
        <SelectField label="Предмет" value={crud.filters.subject} onChange={(value) => crud.setFilters({ ...crud.filters, subject: value })} options={[{ value: '', label: 'Все' }, ...subjectOptions]} />
      </Filters>

      <Table
        data={crud.items}
        empty="Групп пока нет"
        columns={[
          { key: 'name', header: 'Название' },
          { key: 'subject_name', header: 'Предмет' },
          { key: 'teacher_name', header: 'Учитель' },
          { key: 'manager_name', header: 'Менеджер' },
          { key: 'students_count', header: 'Ученики' },
          { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{statusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" onClick={() => setSelectedGroup(row)} aria-label="Ученики">
                  <Users size={16} />
                </Button>
                <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} />
              </div>
            ),
          },
        ]}
      />

      <CrudModal title="Группа" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={groupFields} form={form} setForm={crud.setEditing} saving={crud.saving} onSubmit={() => crud.save(form)} />

      <Modal title={selectedGroup ? `Ученики: ${selectedGroup.name}` : 'Ученики'} open={Boolean(selectedGroup)} onClose={() => setSelectedGroup(null)}>
        {canEdit && (
          <div className="mb-5 grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 md:grid-cols-[1.3fr_0.8fr_1fr_auto]">
            <SelectField label="Ученик" value={memberForm.client} onChange={(value) => setMemberForm({ ...memberForm, client: value })} options={[{ value: '', label: 'Выберите ученика' }, ...clientOptions]} />
            <SelectField label="Статус" value={memberForm.status} onChange={(value) => setMemberForm({ ...memberForm, status: value })} options={memberStatusOptions} />
            <Input label="Комментарий" value={memberForm.note} onChange={(event) => setMemberForm({ ...memberForm, note: event.target.value })} />
            <div className="flex items-end">
              <Button onClick={addMember}>Добавить</Button>
            </div>
          </div>
        )}
        <Table
          data={members}
          empty="В группе нет учеников"
          columns={[
            { key: 'client_name', header: 'Ученик' },
            { key: 'client_phone', header: 'Телефон' },
            { key: 'status', header: 'Статус', render: (row) => <SelectField label="" value={row.status} onChange={(value) => updateMember(row, value)} options={memberStatusOptions} /> },
            { key: 'note', header: 'Комментарий' },
            {
              key: 'actions',
              header: '',
              render: (row) => canEdit ? <Button variant="danger" onClick={() => removeMember(row)}>Удалить</Button> : null,
            },
          ]}
        />
      </Modal>
    </>
  );
}
