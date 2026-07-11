import { CalendarDays, ClipboardCheck, Eye, Plus, UserMinus, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/axios.js';
import ClientSelectWithCreate from '../components/clients/ClientSelectWithCreate.jsx';
import Modal from '../components/ui/Modal.jsx';
import { canDeleteDangerous, getStoredUser, hasRole, ROLES } from '../auth.js';
import { ActionButton, Actions, Badge, Button, Filters, Input, PageHeader, SelectField, Table, showApiError, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions, useRoomOptions, useSubjectOptions } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';

const emptyGroup = {
  name: '',
  subject: '',
  room: '',
  teacher: '',
  manager: '',
  schedule_days: [],
  start_time: '',
  end_time: '',
  start_date: '',
  end_date: '',
  status: 'active',
  description: '',
  branch: '',
};

const weekdays = [
  { value: 'monday', label: 'ПН' },
  { value: 'tuesday', label: 'ВТ' },
  { value: 'wednesday', label: 'СР' },
  { value: 'thursday', label: 'ЧТ' },
  { value: 'friday', label: 'ПТ' },
  { value: 'saturday', label: 'СБ' },
  { value: 'sunday', label: 'ВС' },
];

const statusOptions = [
  { value: '', label: 'Все' },
  { value: 'active', label: 'Активная' },
  { value: 'paused', label: 'На паузе' },
  { value: 'archived', label: 'Архив' },
];

const weekdayShort = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('ru-RU') : '');

export default function GroupsPage() {
  const crud = useCrudResource('study-groups/', { search: '', status: '', teacher: '', subject: '', branch: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { subjectOptions } = useSubjectOptions();
  const { rooms, roomOptions } = useRoomOptions();
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const { clients, clientOptions } = useClientOptions();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberStatusFilter, setMemberStatusFilter] = useState('active');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberForm, setMemberForm] = useState({ client: '', note: '' });
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);
  const [groupToDisable, setGroupToDisable] = useState(null);
  const [groupError, setGroupError] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);
  const user = getStoredUser();
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || emptyGroup;

  const openGroupForm = (group = null) => {
    setGroupError('');
    crud.setEditing({
      ...emptyGroup,
      ...(group || {}),
      subject: group?.subject ? String(group.subject) : '',
      room: group?.room ? String(group.room) : '',
      teacher: group?.teacher ? String(group.teacher) : '',
      manager: group?.manager ? String(group.manager) : '',
      schedule_days: Array.isArray(group?.schedule_days) ? group.schedule_days : [],
      start_time: group?.start_time ? String(group.start_time).slice(0, 5) : '',
      end_time: group?.end_time ? String(group.end_time).slice(0, 5) : '',
    });
    crud.setModalOpen(true);
  };

  const setGroupForm = (patch) => crud.setEditing({ ...form, ...patch });
  const filteredRoomOptions = roomOptions.filter((option) => {
    if (!form.branch) return true;
    const room = rooms.find((item) => String(item.id) === String(option.value));
    return !room?.branch || String(room.branch) === String(form.branch);
  });
  const selectedClient = clients.find((client) => String(client.id) === String(memberForm.client));
  const clientBranchDiffers = selectedGroup?.branch && selectedClient?.branch && String(selectedGroup.branch) !== String(selectedClient.branch);

  const toggleScheduleDay = (day) => {
    const current = Array.isArray(form.schedule_days) ? form.schedule_days : [];
    setGroupForm({
      schedule_days: current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    });
  };

  const validateGroup = () => {
    if (!form.name?.trim()) return 'Укажите название группы.';
    if (!form.schedule_days?.length) return 'Выберите хотя бы один день недели.';
    if (!form.start_time) return 'Укажите время начала.';
    if (!form.end_time) return 'Укажите время окончания.';
    if (form.end_time <= form.start_time) return 'Время окончания должно быть позже времени начала.';
    return '';
  };

  const saveGroup = async () => {
    const validationError = validateGroup();
    if (validationError) {
      setGroupError(validationError);
      return;
    }
    setGroupSaving(true);
    setGroupError('');
    const payload = {
      name: form.name,
      subject: form.subject || null,
      room: form.room || null,
      teacher: form.teacher || null,
      manager: form.manager || null,
      schedule_days: form.schedule_days || [],
      start_time: form.start_time ? `${form.start_time}:00` : null,
      end_time: form.end_time ? `${form.end_time}:00` : null,
      status: form.status || 'active',
      description: form.description || '',
      branch: form.branch || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    try {
      if (form.id) {
        await api.patch(`study-groups/${form.id}/`, payload);
      } else {
        await api.post('study-groups/', payload);
      }
      crud.setModalOpen(false);
      crud.setEditing(null);
      await crud.reload();
    } catch (error) {
      setGroupError(error.response?.data?.detail || 'Не удалось сохранить группу.');
      showApiError(error);
    } finally {
      setGroupSaving(false);
    }
  };

  const loadMembers = async (group, statusValue = memberStatusFilter) => {
    const { data } = await api.get(`study-groups/${group.id}/members/`, { params: { status: statusValue } });
    setMembers(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    if (selectedGroup) loadMembers(selectedGroup, memberStatusFilter);
  }, [selectedGroup?.id, memberStatusFilter]);

  const refreshSelectedGroup = async () => {
    if (!selectedGroup) return;
    const { data } = await api.get(`study-groups/${selectedGroup.id}/`);
    setSelectedGroup(data);
  };

  const addMember = async () => {
    if (!selectedGroup || !memberForm.client) return;
    setMemberSaving(true);
    try {
      await api.post(`study-groups/${selectedGroup.id}/add-member/`, memberForm);
      setMemberForm({ client: '', note: '' });
      setMemberModalOpen(false);
      setMemberStatusFilter('active');
      await loadMembers(selectedGroup, 'active');
      await crud.reload();
      await refreshSelectedGroup();
    } catch (error) {
      showApiError(error);
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async () => {
    if (!selectedGroup || !memberToRemove) return;
    try {
      await api.post(`study-groups/${selectedGroup.id}/remove-member/`, { client: memberToRemove.client });
      setMemberToRemove(null);
      await loadMembers(selectedGroup, memberStatusFilter);
      await crud.reload();
      await refreshSelectedGroup();
    } catch (error) {
      showApiError(error);
    }
  };

  const restoreMember = async (member) => {
    try {
      await api.post(`study-groups/${selectedGroup.id}/restore-member/`, { client: member.client });
      setMemberStatusFilter('active');
      await loadMembers(selectedGroup, 'active');
      await crud.reload();
      await refreshSelectedGroup();
    } catch (error) {
      showApiError(error);
    }
  };

  const disableGroup = async () => {
    if (!groupToDisable) return;
    try {
      await api.delete(`study-groups/${groupToDisable.id}/`);
      setGroupToDisable(null);
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const visibleMembers = members.filter((member) => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return true;
    return [member.client_name, member.parent_name, member.phone, member.client_phone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const activeCount = members.filter((member) => member.status === 'active').length;
  const inactiveCount = members.filter((member) => member.status !== 'active').length;

  return (
    <>
      <PageHeader title="Группы" actionLabel="Добавить группу" onAction={canEdit ? () => openGroupForm() : undefined} />

      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(event) => crud.setFilters({ ...crud.filters, search: event.target.value })} />
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={statusOptions} />
        <SelectField label="Учитель" value={crud.filters.teacher} onChange={(value) => crud.setFilters({ ...crud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
        <SelectField label="Предмет" value={crud.filters.subject} onChange={(value) => crud.setFilters({ ...crud.filters, subject: value })} options={[{ value: '', label: 'Все' }, ...subjectOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
      </Filters>

      <Table
        data={crud.items}
        empty="Групп пока нет"
        columns={[
          { key: 'name', header: 'Название' },
          { key: 'subject_name', header: 'Предмет' },
          { key: 'teacher_name', header: 'Учитель' },
          { key: 'manager_name', header: 'Менеджер' },
          { key: 'schedule_display', header: 'Расписание', render: (row) => row.schedule_display || 'Не указано' },
          { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
          { key: 'students_count', header: 'Ученики' },
          { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{statusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <ActionButton as={Link} to={`/schedule?group=${row.id}`} icon={CalendarDays} label="Расписание" title="Открыть расписание" />
                <ActionButton as={Link} to={`/visits?group=${row.id}`} icon={ClipboardCheck} label="Посещения" title="Открыть посещения" />
                <ActionButton icon={Users} label="Ученики" title="Ученики группы" onClick={() => setSelectedGroup(row)} />
                <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => openGroupForm(row)} onDelete={() => setGroupToDisable(row)} />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={form.id ? 'Редактировать группу' : 'Добавить группу'}
        open={crud.modalOpen}
        onClose={() => crud.setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => crud.setModalOpen(false)}>Отмена</Button>
            <Button onClick={saveGroup} disabled={groupSaving}>{groupSaving ? 'Сохраняем...' : 'Сохранить'}</Button>
          </>
        }
      >
        {groupError && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{groupError}</div>}
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название" value={form.name || ''} onChange={(event) => setGroupForm({ name: event.target.value })} />
          <SelectField label="Предмет" value={form.subject || ''} onChange={(value) => setGroupForm({ subject: value })} options={[{ value: '', label: 'Не выбран' }, ...subjectOptions]} />
          <SelectField label="Филиал" value={form.branch || ''} onChange={(value) => setGroupForm({ branch: value, room: '' })} options={[{ value: '', label: 'Не распределено' }, ...branchOptions]} />
          <SelectField label="Учитель" value={form.teacher || ''} onChange={(value) => setGroupForm({ teacher: value })} options={[{ value: '', label: 'Не выбран' }, ...teacherOptions]} />
          <SelectField label="Менеджер" value={form.manager || ''} onChange={(value) => setGroupForm({ manager: value })} options={[{ value: '', label: 'Не выбран' }, ...managerOptions]} />
          <SelectField label="Кабинет" value={form.room || ''} onChange={(value) => setGroupForm({ room: value })} options={[{ value: '', label: 'Не выбран' }, ...filteredRoomOptions]} />
          <SelectField label="Статус" value={form.status || 'active'} onChange={(value) => setGroupForm({ status: value })} options={statusOptions.filter((item) => item.value)} />

          <div className="grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-bold text-slate-800">Расписание группы</p>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day) => (
                <label key={day.value} className={`flex min-h-10 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold ${form.schedule_days?.includes(day.value) ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <input className="sr-only" type="checkbox" checked={form.schedule_days?.includes(day.value) || false} onChange={() => toggleScheduleDay(day.value)} />
                  {day.label}
                </label>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Время начала" type="time" value={form.start_time || ''} onChange={(event) => setGroupForm({ start_time: event.target.value })} />
              <Input label="Время окончания" type="time" value={form.end_time || ''} onChange={(event) => setGroupForm({ end_time: event.target.value })} />
            </div>
          </div>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
            Описание
            <textarea
              className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={form.description || ''}
              onChange={(event) => setGroupForm({ description: event.target.value })}
            />
          </label>
        </div>
      </Modal>

      <Modal title={selectedGroup ? `Ученики группы: ${selectedGroup.name}` : 'Ученики группы'} open={Boolean(selectedGroup)} onClose={() => setSelectedGroup(null)} size="wide">
        {selectedGroup && (
          <div className="mb-5 grid gap-4 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card">
            <div>
              <p className="text-xs font-bold uppercase text-slate-400">Расписание</p>
              <p className="mt-1 font-semibold text-slate-900">{selectedGroup.schedule_display || 'Не указано'}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Ближайшие занятия</p>
                <div className="mt-2 grid gap-1 text-sm text-slate-700">
                  {selectedGroup.upcoming_lessons?.length
                    ? selectedGroup.upcoming_lessons.map((lesson) => {
                      const lessonDate = new Date(lesson.date);
                      return <span key={`${lesson.date}-${lesson.start_time}`}>{formatDate(lesson.date)} {weekdayShort[lessonDate.getDay()]} {lesson.start_time}-{lesson.end_time}</span>;
                    })
                    : <span>Недостаточно данных для расчёта</span>}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Остатки учеников</p>
                <div className="mt-2 grid gap-1 text-sm text-slate-700">
                  {selectedGroup.student_summaries?.length
                    ? selectedGroup.student_summaries.map((student) => (
                      <span key={student.client}>{student.client_name}: {student.remaining_lessons ?? 'Недостаточно данных для расчёта'} {student.expected_end_date ? `до ${formatDate(student.expected_end_date)}` : ''}</span>
                    ))
                    : <span>Недостаточно данных для расчёта</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-5 flex flex-col gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 md:flex-row md:items-end md:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-[1fr_auto]">
            <Input label="Поиск ученика" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
            <div className="flex items-end gap-2">
              {[
                { value: 'active', label: 'Активные' },
                { value: 'inactive', label: 'Бывшие' },
                { value: 'all', label: 'Все' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setMemberStatusFilter(item.value)}
                  className={`min-h-11 rounded-2xl border px-4 text-sm font-bold transition ${memberStatusFilter === item.value ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-brand/40'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {canEdit && (
            <Button onClick={() => setMemberModalOpen(true)}>
              <Plus size={16} />
              Добавить ученика
            </Button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-sm font-semibold text-slate-500">
          <span>Активных: {selectedGroup?.students_count ?? activeCount}</span>
          <span>Бывших: {memberStatusFilter === 'all' ? inactiveCount : memberStatusFilter === 'inactive' ? visibleMembers.length : '—'}</span>
        </div>

        <Table
          data={visibleMembers}
          empty="В группе нет учеников"
          columns={[
            { key: 'client_name', header: 'Ученик' },
            { key: 'parent_name', header: 'Родитель', render: (row) => row.parent_name || '—' },
            { key: 'phone', header: 'Телефон', render: (row) => row.phone || row.client_phone || '—' },
            { key: 'active_subscription', header: 'Абонемент', render: (row) => row.active_subscription?.name || 'Нет активного абонемента' },
            { key: 'remaining', header: 'Остаток', render: (row) => row.active_subscription?.remaining_visits ?? '—' },
            { key: 'end_date', header: 'Дата окончания', render: (row) => formatDate(row.active_subscription?.end_date) || '—' },
            { key: 'joined_at', header: 'Дата добавления', render: (row) => formatDate(row.joined_at || row.created_at) || '—' },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <ActionButton as={Link} to={`/clients/${row.client}`} icon={Eye} label="Открыть клиента" title="Открыть клиента" />
                  {canEdit && row.status === 'active' && (
                    <ActionButton icon={UserMinus} label="Убрать из группы" title="Убрать из группы" variant="danger" onClick={() => setMemberToRemove(row)} />
                  )}
                  {canEdit && row.status !== 'active' && (
                    <ActionButton icon={UserPlus} label="Вернуть в группу" title="Вернуть в группу" onClick={() => restoreMember(row)} />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="Добавить ученика"
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMemberModalOpen(false)}>Отмена</Button>
            <Button onClick={addMember} disabled={!memberForm.client || memberSaving}>{memberSaving ? 'Добавляем...' : 'Добавить'}</Button>
          </>
        }
      >
        <div className="grid gap-4">
          <ClientSelectWithCreate
            label="Ученик"
            value={memberForm.client}
            onChange={(value) => setMemberForm({ ...memberForm, client: value })}
            options={clientOptions}
            placeholder="Выберите ученика"
          />
          {clientBranchDiffers && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              Филиал клиента отличается от филиала группы.
            </div>
          )}
          <Input label="Комментарий" value={memberForm.note} onChange={(event) => setMemberForm({ ...memberForm, note: event.target.value })} />
        </div>
      </Modal>

      <Modal
        title="Убрать ученика из группы?"
        open={Boolean(memberToRemove)}
        onClose={() => setMemberToRemove(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMemberToRemove(null)}>Отмена</Button>
            <Button variant="danger" onClick={removeMember}>Убрать из группы</Button>
          </>
        }
      >
        <p className="text-sm font-semibold text-slate-700">
          {memberToRemove?.client_name || 'Ученик'} больше не будет появляться в новых табелях этой группы. Клиент, абонемент и история посещений сохранятся.
        </p>
      </Modal>

      <Modal
        title="Отключить группу?"
        open={Boolean(groupToDisable)}
        onClose={() => setGroupToDisable(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGroupToDisable(null)}>Отмена</Button>
            <Button variant="danger" onClick={disableGroup}>Отключить группу</Button>
          </>
        }
      >
        <p className="text-sm font-semibold text-slate-700">
          Группа будет перенесена в архив. Клиенты, состав, прошлые занятия и посещения сохранятся.
        </p>
      </Modal>
    </>
  );
}
