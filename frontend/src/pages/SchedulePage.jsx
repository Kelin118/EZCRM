import { CalendarDays, CheckSquare, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';

import api from '../api/axios.js';
import Modal from '../components/ui/Modal.jsx';
import { canDeleteDangerous, getStoredUser, hasRole, ROLES } from '../auth.js';
import { ActionButton, Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, Table, dateOnly, showApiError, useCrudResource } from './pageUtils.jsx';
import { useEmployeeOptions, useRoomOptions, useStudyGroupOptions, useSubjectOptions } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';

const weekdayOptions = [
  { value: '', label: 'Все' },
  { value: '0', label: 'Понедельник' },
  { value: '1', label: 'Вторник' },
  { value: '2', label: 'Среда' },
  { value: '3', label: 'Четверг' },
  { value: '4', label: 'Пятница' },
  { value: '5', label: 'Суббота' },
  { value: '6', label: 'Воскресенье' },
];

const lessonStatusOptions = [
  { value: '', label: 'Все' },
  { value: 'planned', label: 'Запланирован' },
  { value: 'completed', label: 'Проведён' },
  { value: 'cancelled', label: 'Отменён' },
];

const emptySlot = {
  branch: '',
  group: '',
  subject: '',
  teacher: '',
  room: '',
  weekday: '0',
  start_time: '',
  end_time: '',
  is_active: true,
};

const emptyLesson = {
  branch: '',
  group: '',
  schedule_slot: '',
  subject: '',
  teacher: '',
  room: '',
  lesson_date: '',
  start_time: '',
  end_time: '',
  topic: '',
  status: 'planned',
  comment: '',
};

export default function SchedulePage() {
  const [searchParams] = useSearchParams();
  const initialGroup = searchParams.get('group') || '';
  const [tab, setTab] = useState('slots');
  const slotCrud = useCrudResource('schedule-slots/', { group: initialGroup, teacher: '', weekday: '', room: '', is_active: '', branch: '' });
  const lessonCrud = useCrudResource('lessons/', { date_from: '', date_to: '', group: initialGroup, teacher: '', status: '', branch: '' });
  const { branchOptions } = useBranches();
  const { groupOptions } = useStudyGroupOptions();
  const { subjectOptions } = useSubjectOptions();
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const { roomOptions } = useRoomOptions();
  const [generateSlot, setGenerateSlot] = useState(null);
  const [generateForm, setGenerateForm] = useState({ date_from: '', date_to: '' });
  const user = getStoredUser();
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
  const canDelete = canDeleteDangerous(user);

  const slotFields = useMemo(
    () => [
      { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из группы' }, ...branchOptions] },
      { name: 'group', label: 'Группа', type: 'select', options: [{ value: '', label: 'Выберите группу' }, ...groupOptions] },
      { name: 'subject', label: 'Предмет', type: 'select', options: [{ value: '', label: 'Из группы' }, ...subjectOptions] },
      { name: 'teacher', label: 'Преподаватель', type: 'select', options: [{ value: '', label: 'Из группы' }, ...teacherOptions] },
      { name: 'room', label: 'Кабинет', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...roomOptions] },
      { name: 'weekday', label: 'День недели', type: 'select', options: weekdayOptions.filter((item) => item.value !== '') },
      { name: 'start_time', label: 'Время начала', type: 'time' },
      { name: 'end_time', label: 'Время окончания', type: 'time' },
      {
        name: 'is_active',
        label: 'Активен',
        type: 'select',
        options: [{ value: true, label: 'Да' }, { value: false, label: 'Нет' }],
      },
    ],
    [groupOptions, subjectOptions, teacherOptions, roomOptions, branchOptions],
  );

  const lessonFields = useMemo(
    () => [
      { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из расписания/группы' }, ...branchOptions] },
      { name: 'group', label: 'Группа', type: 'select', options: [{ value: '', label: 'Не выбрана' }, ...groupOptions] },
      { name: 'subject', label: 'Предмет', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...subjectOptions] },
      { name: 'teacher', label: 'Преподаватель', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
      { name: 'room', label: 'Кабинет', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...roomOptions] },
      { name: 'lesson_date', label: 'Дата', type: 'date' },
      { name: 'start_time', label: 'Время начала', type: 'time' },
      { name: 'end_time', label: 'Время окончания', type: 'time' },
      { name: 'topic', label: 'Тема' },
      { name: 'status', label: 'Статус', type: 'select', options: lessonStatusOptions.filter((item) => item.value) },
      { name: 'comment', label: 'Комментарий', type: 'textarea' },
    ],
    [groupOptions, subjectOptions, teacherOptions, roomOptions, branchOptions],
  );

  const generateLessons = async () => {
    try {
      await api.post(`schedule-slots/${generateSlot.id}/generate-lessons/`, generateForm);
      setGenerateSlot(null);
      setGenerateForm({ date_from: '', date_to: '' });
      await lessonCrud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const cancelLesson = async (lesson) => {
    try {
      await api.patch(`lessons/${lesson.id}/cancel/`);
      await lessonCrud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader title="Расписание" actionLabel={tab === 'slots' ? 'Добавить слот' : 'Добавить урок'} onAction={canEdit ? () => {
        if (tab === 'slots') {
          slotCrud.setEditing(emptySlot);
          slotCrud.setModalOpen(true);
        } else {
          lessonCrud.setEditing(emptyLesson);
          lessonCrud.setModalOpen(true);
        }
      } : undefined}>
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'slots' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('slots')}>Регулярное расписание</button>
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'lessons' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('lessons')}>Уроки</button>
        </div>
      </PageHeader>

      {tab === 'slots' && (
        <>
          <Filters>
            <SelectField label="Филиал" value={slotCrud.filters.branch} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
            <SelectField label="Группа" value={slotCrud.filters.group} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, group: value })} options={[{ value: '', label: 'Все' }, ...groupOptions]} />
            <SelectField label="Преподаватель" value={slotCrud.filters.teacher} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
            <SelectField label="День" value={slotCrud.filters.weekday} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, weekday: value })} options={weekdayOptions} />
            <SelectField label="Кабинет" value={slotCrud.filters.room} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, room: value })} options={[{ value: '', label: 'Все' }, ...roomOptions]} />
          </Filters>
          <Table
            data={slotCrud.items}
            empty="Расписание пока пустое"
            columns={[
              { key: 'group_name', header: 'Группа' },
              { key: 'subject_name', header: 'Предмет' },
              { key: 'teacher_name', header: 'Преподаватель' },
              { key: 'room_name', header: 'Кабинет' },
              { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
              { key: 'weekday_display', header: 'День недели' },
              { key: 'time', header: 'Время', render: (row) => `${row.start_time?.slice(0, 5)} - ${row.end_time?.slice(0, 5)}` },
              { key: 'is_active', header: 'Активен', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Да' : 'Нет'}</Badge> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    {canEdit && <Button variant="secondary" onClick={() => { setGenerateSlot(row); setGenerateForm({ date_from: '', date_to: '' }); }}><CalendarDays size={16} />Сгенерировать</Button>}
                    <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { slotCrud.setEditing(row); slotCrud.setModalOpen(true); }} onDelete={() => slotCrud.remove(row.id)} />
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 'lessons' && (
        <>
          <Filters>
            <SelectField label="Филиал" value={lessonCrud.filters.branch} onChange={(value) => lessonCrud.setFilters({ ...lessonCrud.filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
            <Input label="Дата от" type="date" value={lessonCrud.filters.date_from} onChange={(event) => lessonCrud.setFilters({ ...lessonCrud.filters, date_from: event.target.value })} />
            <Input label="Дата до" type="date" value={lessonCrud.filters.date_to} onChange={(event) => lessonCrud.setFilters({ ...lessonCrud.filters, date_to: event.target.value })} />
            <SelectField label="Группа" value={lessonCrud.filters.group} onChange={(value) => lessonCrud.setFilters({ ...lessonCrud.filters, group: value })} options={[{ value: '', label: 'Все' }, ...groupOptions]} />
            <SelectField label="Статус" value={lessonCrud.filters.status} onChange={(value) => lessonCrud.setFilters({ ...lessonCrud.filters, status: value })} options={lessonStatusOptions} />
          </Filters>
          <Table
            data={lessonCrud.items}
            empty="Уроков за период нет"
            columns={[
              { key: 'lesson_date', header: 'Дата', render: (row) => dateOnly(row.lesson_date) },
              { key: 'time', header: 'Время', render: (row) => `${row.start_time?.slice(0, 5)} - ${row.end_time?.slice(0, 5)}` },
              { key: 'group_name', header: 'Группа' },
              { key: 'subject_name', header: 'Предмет' },
              { key: 'teacher_name', header: 'Преподаватель' },
              { key: 'room_name', header: 'Кабинет' },
              { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
              { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
              { key: 'visits', header: 'Посещения', render: (row) => `${row.attended_count || 0}/${row.visits_count || 0}` },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <Link to={`/visits?lesson=${row.id}`}>
                      <Button variant="secondary"><CheckSquare size={16} />Отметить посещения</Button>
                    </Link>
                    {canEdit && <ActionButton icon={XCircle} label="Отменить" onClick={() => cancelLesson(row)} variant="danger" />}
                    <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { lessonCrud.setEditing(row); lessonCrud.setModalOpen(true); }} onDelete={() => lessonCrud.remove(row.id)} />
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      <CrudModal title="Слот расписания" open={slotCrud.modalOpen} onClose={() => slotCrud.setModalOpen(false)} fields={slotFields} form={slotCrud.editing || emptySlot} setForm={slotCrud.setEditing} saving={slotCrud.saving} onSubmit={() => slotCrud.save(slotCrud.editing || emptySlot)} />
      <CrudModal title="Урок" open={lessonCrud.modalOpen} onClose={() => lessonCrud.setModalOpen(false)} fields={lessonFields} form={lessonCrud.editing || emptyLesson} setForm={lessonCrud.setEditing} saving={lessonCrud.saving} onSubmit={() => lessonCrud.save(lessonCrud.editing || emptyLesson)} />

      <Modal
        title="Сгенерировать уроки"
        open={Boolean(generateSlot)}
        onClose={() => setGenerateSlot(null)}
        footer={<><Button variant="secondary" onClick={() => setGenerateSlot(null)}>Отмена</Button><Button onClick={generateLessons}><CalendarDays size={16} />Сгенерировать</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Дата от" type="date" value={generateForm.date_from} onChange={(event) => setGenerateForm({ ...generateForm, date_from: event.target.value })} />
          <Input label="Дата до" type="date" value={generateForm.date_to} onChange={(event) => setGenerateForm({ ...generateForm, date_to: event.target.value })} />
        </div>
      </Modal>
    </>
  );
}

