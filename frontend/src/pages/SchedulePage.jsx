import { CalendarDays, CheckSquare, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';

import api from '../api/axios.js';
import Modal from '../components/ui/Modal.jsx';
import { canDeleteDangerous, getStoredUser, hasRole, ROLES } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, Table, dateOnly, showApiError, useCrudResource } from './pageUtils.jsx';
import { useEmployeeOptions, useRoomOptions, useStudyGroupOptions, useSubjectOptions } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';

const weekdayOptions = [
  { value: '', label: 'Р’СЃРµ' },
  { value: '0', label: 'РџРѕРЅРµРґРµР»СЊРЅРёРє' },
  { value: '1', label: 'Р’С‚РѕСЂРЅРёРє' },
  { value: '2', label: 'РЎСЂРµРґР°' },
  { value: '3', label: 'Р§РµС‚РІРµСЂРі' },
  { value: '4', label: 'РџСЏС‚РЅРёС†Р°' },
  { value: '5', label: 'РЎСѓР±Р±РѕС‚Р°' },
  { value: '6', label: 'Р’РѕСЃРєСЂРµСЃРµРЅСЊРµ' },
];

const lessonStatusOptions = [
  { value: '', label: 'Р’СЃРµ' },
  { value: 'planned', label: 'Р—Р°РїР»Р°РЅРёСЂРѕРІР°РЅ' },
  { value: 'completed', label: 'РџСЂРѕРІРµРґС‘РЅ' },
  { value: 'cancelled', label: 'РћС‚РјРµРЅС‘РЅ' },
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
      { name: 'group', label: 'Р“СЂСѓРїРїР°', type: 'select', options: [{ value: '', label: 'Р’С‹Р±РµСЂРёС‚Рµ РіСЂСѓРїРїСѓ' }, ...groupOptions] },
      { name: 'subject', label: 'РџСЂРµРґРјРµС‚', type: 'select', options: [{ value: '', label: 'РР· РіСЂСѓРїРїС‹' }, ...subjectOptions] },
      { name: 'teacher', label: 'РЈС‡РёС‚РµР»СЊ', type: 'select', options: [{ value: '', label: 'РР· РіСЂСѓРїРїС‹' }, ...teacherOptions] },
      { name: 'room', label: 'РљР°Р±РёРЅРµС‚', type: 'select', options: [{ value: '', label: 'РќРµ РІС‹Р±СЂР°РЅ' }, ...roomOptions] },
      { name: 'weekday', label: 'Р”РµРЅСЊ РЅРµРґРµР»Рё', type: 'select', options: weekdayOptions.filter((item) => item.value !== '') },
      { name: 'start_time', label: 'РќР°С‡Р°Р»Рѕ', type: 'time' },
      { name: 'end_time', label: 'РћРєРѕРЅС‡Р°РЅРёРµ', type: 'time' },
      {
        name: 'is_active',
        label: 'РђРєС‚РёРІРµРЅ',
        type: 'select',
        options: [{ value: true, label: 'Р”Р°' }, { value: false, label: 'РќРµС‚' }],
      },
    ],
    [groupOptions, subjectOptions, teacherOptions, roomOptions, branchOptions],
  );

  const lessonFields = useMemo(
    () => [
      { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из расписания/группы' }, ...branchOptions] },
      { name: 'group', label: 'Р“СЂСѓРїРїР°', type: 'select', options: [{ value: '', label: 'РќРµ РІС‹Р±СЂР°РЅР°' }, ...groupOptions] },
      { name: 'subject', label: 'РџСЂРµРґРјРµС‚', type: 'select', options: [{ value: '', label: 'РќРµ РІС‹Р±СЂР°РЅ' }, ...subjectOptions] },
      { name: 'teacher', label: 'РЈС‡РёС‚РµР»СЊ', type: 'select', options: [{ value: '', label: 'РќРµ РІС‹Р±СЂР°РЅ' }, ...teacherOptions] },
      { name: 'room', label: 'РљР°Р±РёРЅРµС‚', type: 'select', options: [{ value: '', label: 'РќРµ РІС‹Р±СЂР°РЅ' }, ...roomOptions] },
      { name: 'lesson_date', label: 'Р”Р°С‚Р°', type: 'date' },
      { name: 'start_time', label: 'РќР°С‡Р°Р»Рѕ', type: 'time' },
      { name: 'end_time', label: 'РћРєРѕРЅС‡Р°РЅРёРµ', type: 'time' },
      { name: 'topic', label: 'РўРµРјР°' },
      { name: 'status', label: 'РЎС‚Р°С‚СѓСЃ', type: 'select', options: lessonStatusOptions.filter((item) => item.value) },
      { name: 'comment', label: 'РљРѕРјРјРµРЅС‚Р°СЂРёР№', type: 'textarea' },
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
      <PageHeader title="Р Р°СЃРїРёСЃР°РЅРёРµ" actionLabel={tab === 'slots' ? 'Р”РѕР±Р°РІРёС‚СЊ СЃР»РѕС‚' : 'Р”РѕР±Р°РІРёС‚СЊ СѓСЂРѕРє'} onAction={canEdit ? () => {
        if (tab === 'slots') {
          slotCrud.setEditing(emptySlot);
          slotCrud.setModalOpen(true);
        } else {
          lessonCrud.setEditing(emptyLesson);
          lessonCrud.setModalOpen(true);
        }
      } : undefined}>
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'slots' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('slots')}>Р РµРіСѓР»СЏСЂРЅРѕРµ СЂР°СЃРїРёСЃР°РЅРёРµ</button>
          <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'lessons' ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setTab('lessons')}>РЈСЂРѕРєРё</button>
        </div>
      </PageHeader>

      {tab === 'slots' && (
        <>
          <Filters>
            <SelectField label="Филиал" value={slotCrud.filters.branch} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
            <SelectField label="Р“СЂСѓРїРїР°" value={slotCrud.filters.group} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, group: value })} options={[{ value: '', label: 'Р’СЃРµ' }, ...groupOptions]} />
            <SelectField label="РЈС‡РёС‚РµР»СЊ" value={slotCrud.filters.teacher} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, teacher: value })} options={[{ value: '', label: 'Р’СЃРµ' }, ...teacherOptions]} />
            <SelectField label="Р”РµРЅСЊ" value={slotCrud.filters.weekday} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, weekday: value })} options={weekdayOptions} />
            <SelectField label="РљР°Р±РёРЅРµС‚" value={slotCrud.filters.room} onChange={(value) => slotCrud.setFilters({ ...slotCrud.filters, room: value })} options={[{ value: '', label: 'Р’СЃРµ' }, ...roomOptions]} />
          </Filters>
          <Table
            data={slotCrud.items}
            empty="Р Р°СЃРїРёСЃР°РЅРёРµ РїРѕРєР° РїСѓСЃС‚РѕРµ"
            columns={[
              { key: 'group_name', header: 'Р“СЂСѓРїРїР°' },
              { key: 'subject_name', header: 'РџСЂРµРґРјРµС‚' },
              { key: 'teacher_name', header: 'РЈС‡РёС‚РµР»СЊ' },
              { key: 'room_name', header: 'РљР°Р±РёРЅРµС‚' },
              { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
              { key: 'weekday_display', header: 'Р”РµРЅСЊ РЅРµРґРµР»Рё' },
              { key: 'time', header: 'Р’СЂРµРјСЏ', render: (row) => `${row.start_time?.slice(0, 5)} - ${row.end_time?.slice(0, 5)}` },
              { key: 'is_active', header: 'РђРєС‚РёРІРµРЅ', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Р”Р°' : 'РќРµС‚'}</Badge> },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    {canEdit && <Button variant="secondary" onClick={() => { setGenerateSlot(row); setGenerateForm({ date_from: '', date_to: '' }); }}><CalendarDays size={16} />РЎРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ</Button>}
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
            <Input label="Р”Р°С‚Р° РѕС‚" type="date" value={lessonCrud.filters.date_from} onChange={(event) => lessonCrud.setFilters({ ...lessonCrud.filters, date_from: event.target.value })} />
            <Input label="Р”Р°С‚Р° РґРѕ" type="date" value={lessonCrud.filters.date_to} onChange={(event) => lessonCrud.setFilters({ ...lessonCrud.filters, date_to: event.target.value })} />
            <SelectField label="Р“СЂСѓРїРїР°" value={lessonCrud.filters.group} onChange={(value) => lessonCrud.setFilters({ ...lessonCrud.filters, group: value })} options={[{ value: '', label: 'Р’СЃРµ' }, ...groupOptions]} />
            <SelectField label="РЎС‚Р°С‚СѓСЃ" value={lessonCrud.filters.status} onChange={(value) => lessonCrud.setFilters({ ...lessonCrud.filters, status: value })} options={lessonStatusOptions} />
          </Filters>
          <Table
            data={lessonCrud.items}
            empty="РЈСЂРѕРєРѕРІ Р·Р° РїРµСЂРёРѕРґ РЅРµС‚"
            columns={[
              { key: 'lesson_date', header: 'Р”Р°С‚Р°', render: (row) => dateOnly(row.lesson_date) },
              { key: 'time', header: 'Р’СЂРµРјСЏ', render: (row) => `${row.start_time?.slice(0, 5)} - ${row.end_time?.slice(0, 5)}` },
              { key: 'group_name', header: 'Р“СЂСѓРїРїР°' },
              { key: 'subject_name', header: 'РџСЂРµРґРјРµС‚' },
              { key: 'teacher_name', header: 'РЈС‡РёС‚РµР»СЊ' },
              { key: 'room_name', header: 'РљР°Р±РёРЅРµС‚' },
              { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
              { key: 'status', header: 'РЎС‚Р°С‚СѓСЃ', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
              { key: 'visits', header: 'РџРѕСЃРµС‰РµРЅРёСЏ', render: (row) => `${row.attended_count || 0}/${row.visits_count || 0}` },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <Link to={`/visits?lesson=${row.id}`}>
                      <Button variant="secondary"><CheckSquare size={16} />Отметить посещения</Button>
                    </Link>
                    {canEdit && <Button variant="danger" className="h-9 w-9 rounded-xl p-0" onClick={() => cancelLesson(row)} aria-label="РћС‚РјРµРЅРёС‚СЊ"><XCircle size={16} /></Button>}
                    <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { lessonCrud.setEditing(row); lessonCrud.setModalOpen(true); }} onDelete={() => lessonCrud.remove(row.id)} />
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      <CrudModal title="РЎР»РѕС‚ СЂР°СЃРїРёСЃР°РЅРёСЏ" open={slotCrud.modalOpen} onClose={() => slotCrud.setModalOpen(false)} fields={slotFields} form={slotCrud.editing || emptySlot} setForm={slotCrud.setEditing} saving={slotCrud.saving} onSubmit={() => slotCrud.save(slotCrud.editing || emptySlot)} />
      <CrudModal title="РЈСЂРѕРє" open={lessonCrud.modalOpen} onClose={() => lessonCrud.setModalOpen(false)} fields={lessonFields} form={lessonCrud.editing || emptyLesson} setForm={lessonCrud.setEditing} saving={lessonCrud.saving} onSubmit={() => lessonCrud.save(lessonCrud.editing || emptyLesson)} />

      <Modal
        title="РЎРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ СѓСЂРѕРєРё"
        open={Boolean(generateSlot)}
        onClose={() => setGenerateSlot(null)}
        footer={<><Button variant="secondary" onClick={() => setGenerateSlot(null)}>РћС‚РјРµРЅР°</Button><Button onClick={generateLessons}>РЎРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Р”Р°С‚Р° РѕС‚" type="date" value={generateForm.date_from} onChange={(event) => setGenerateForm({ ...generateForm, date_from: event.target.value })} />
          <Input label="Р”Р°С‚Р° РґРѕ" type="date" value={generateForm.date_to} onChange={(event) => setGenerateForm({ ...generateForm, date_to: event.target.value })} />
        </div>
      </Modal>
    </>
  );
}

