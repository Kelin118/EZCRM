import { CalendarDays, ClipboardCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/axios.js';
import ClientSelectWithCreate from '../components/clients/ClientSelectWithCreate.jsx';
import Modal from '../components/ui/Modal.jsx';
import { canDeleteDangerous, getStoredUser, hasRole, ROLES } from '../auth.js';
import { Actions, Badge, Button, Filters, Input, PageHeader, SelectField, Table, showApiError, useCrudResource } from './pageUtils.jsx';
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

const memberStatusOptions = [
  { value: 'active', label: 'Активен' },
  { value: 'paused', label: 'На паузе' },
  { value: 'left', label: 'Ушел' },
];

const weekdayShort = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('ru-RU') : '');

export default function GroupsPage() {
  const crud = useCrudResource('study-groups/', { search: '', status: '', teacher: '', subject: '', branch: '' });
  const { branchOptions } = useBranches();
  const { subjectOptions } = useSubjectOptions();
  const { roomOptions } = useRoomOptions();
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const { clientOptions } = useClientOptions();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberForm, setMemberForm] = useState({ client: '', status: 'active', note: '' });
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
      <PageHeader title="Группы" actionLabel="Добавить группу" onAction={canEdit ? () => openGroupForm() : undefined} />

      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(event) => crud.setFilters({ ...crud.filters, search: event.target.value })} />
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={statusOptions} />
        <SelectField label="Учитель" value={crud.filters.teacher} onChange={(value) => crud.setFilters({ ...crud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
        <SelectField label="Предмет" value={crud.filters.subject} onChange={(value) => crud.setFilters({ ...crud.filters, subject: value })} options={[{ value: '', label: 'Все' }, ...subjectOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
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
          { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
          { key: 'students_count', header: 'Ученики' },
          { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{statusOptions.find((item) => item.value === row.status)?.label || row.status}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Link to={`/schedule?group=${row.id}`}>
                  <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" aria-label="Расписание">
                    <CalendarDays size={16} />
                  </Button>
                </Link>
                <Link to={`/visits?group=${row.id}`}>
                  <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" aria-label="Посещения">
                    <ClipboardCheck size={16} />
                  </Button>
                </Link>
                <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" onClick={() => setSelectedGroup(row)} aria-label="Ученики">
                  <Users size={16} />
                </Button>
                <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => openGroupForm(row)} onDelete={() => crud.remove(row.id)} />
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
          <SelectField label="Филиал" value={form.branch || ''} onChange={(value) => setGroupForm({ branch: value })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
          <SelectField label="Учитель" value={form.teacher || ''} onChange={(value) => setGroupForm({ teacher: value })} options={[{ value: '', label: 'Не выбран' }, ...teacherOptions]} />
          <SelectField label="Менеджер" value={form.manager || ''} onChange={(value) => setGroupForm({ manager: value })} options={[{ value: '', label: 'Не выбран' }, ...managerOptions]} />
          <SelectField label="Кабинет" value={form.room || ''} onChange={(value) => setGroupForm({ room: value })} options={[{ value: '', label: 'Не выбран' }, ...roomOptions]} />
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

      <Modal title={selectedGroup ? `Ученики: ${selectedGroup.name}` : 'Ученики'} open={Boolean(selectedGroup)} onClose={() => setSelectedGroup(null)} size="wide">
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

        {canEdit && (
          <div className="mb-5 grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 md:grid-cols-[1.3fr_0.8fr_1fr_auto]">
            <ClientSelectWithCreate
              label="Ученик"
              value={memberForm.client}
              onChange={(value) => setMemberForm({ ...memberForm, client: value })}
              options={clientOptions}
              placeholder="Выберите ученика"
            />
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
