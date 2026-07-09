import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Save, Search, Thermometer, UserCheck, UserX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageVisits, getStoredUser, hasAnyRole, ROLES } from '../auth.js';
import ClientSelectWithCreate from '../components/clients/ClientSelectWithCreate.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import { Actions, Badge, Filters, Input, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { subscriptionLabel, useClientOptions, useEmployeeOptions, useLookup, useStudyGroupOptions } from './lookupUtils.jsx';

const emptyManualVisit = {
  client: '',
  subscription: '',
  teacher: '',
  visited_at: '',
  status: 'attended',
  notes: '',
};

const emptyStudentVisit = {
  client: '',
  status: 'attended',
  comment: '',
};

export const visitStatusOptions = [
  { value: 'attended', label: 'Посетил' },
  { value: 'sick', label: 'Болел' },
  { value: 'missed', label: 'Пропуск' },
  { value: 'makeup', label: 'Отработка' },
  { value: 'frozen', label: 'Заморозка' },
  { value: 'trial', label: 'Пробное' },
];

const journalStatusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'attended', label: 'Посетил' },
  { value: 'sick', label: 'Болел' },
  { value: 'missed', label: 'Пропуск' },
  { value: 'none', label: 'Не отмечено' },
];

const modeOptions = [
  { value: 'journal', label: 'Табель' },
  { value: 'classic', label: 'Классический' },
];

const pad = (value) => String(value).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseLocalDate = (value) => {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
};
const addDays = (value, count) => {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + count);
  return isoDate(date);
};
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '-');
const timeRange = (lesson) => `${lesson.start_time?.slice(0, 5) || '--:--'}-${lesson.end_time?.slice(0, 5) || '--:--'}`;
const statusLabel = (value) => visitStatusOptions.find((item) => item.value === value)?.label || value || '-';

function lessonTitle(lesson) {
  return [lesson.subject_name, lesson.group_name || lesson.topic].filter(Boolean).join(' · ') || 'Занятие';
}

function dispatchToast(message) {
  window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
}

function normalizeRows(items) {
  return items.map((student) => ({
    ...student,
    subscription: student.visit?.subscription || student.subscription || '',
    status: student.status || '',
    comment: student.comment || '',
    remaining_lessons: student.remaining_lessons ?? student.lessons_left ?? null,
    dirty: false,
  }));
}

function rowChanged(row, initial) {
  return (
    String(row.status || '') !== String(initial?.status || '')
    || String(row.comment || '') !== String(initial?.comment || '')
    || String(row.subscription || '') !== String(initial?.subscription || '')
  );
}

function StatusButton({ active, variant, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition sm:flex-none ${
        active
          ? variant
          : 'border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5 hover:text-brand'
      }`}
    >
      <Icon size={16} />
      {children}
    </button>
  );
}

export default function VisitsPage() {
  const [searchParams] = useSearchParams();
  const initialGroup = searchParams.get('group') || '';
  const initialLesson = searchParams.get('lesson') || '';
  const user = getStoredUser();
  const canEdit = canManageVisits(user);
  const canAddStudent = hasAnyRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
  const canDelete = canDeleteDangerous(user);
  const [mode, setMode] = useState('journal');
  const [selectedDate, setSelectedDate] = useState(isoDate(new Date()));
  const [lessons, setLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [initialRows, setInitialRows] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lessonFilters, setLessonFilters] = useState({ group: initialGroup, teacher: '' });
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualVisit);
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [studentForm, setStudentForm] = useState(emptyStudentVisit);
  const [addingStudent, setAddingStudent] = useState(false);

  const historyCrud = useCrudResource('visits/', { date_from: '', date_to: '', client: '', group: '', teacher: '', status: '', subscription: '' });
  const { clientOptions } = useClientOptions();
  const { groupOptions } = useStudyGroupOptions();
  const { employeeOptions } = useEmployeeOptions(['teacher', 'admin']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const selectedClient = manualForm.client || '';
  const { items: subscriptions, loading: loadingSubscriptions } = useLookup('subscriptions/', { client: selectedClient }, { enabled: Boolean(selectedClient) });
  const subscriptionOptions = useMemo(
    () => subscriptions.map((subscription) => ({ value: String(subscription.id), label: subscriptionLabel(subscription) })),
    [subscriptions],
  );

  const dirtyRows = useMemo(
    () => attendanceRows.filter((row) => rowChanged(row, initialRows.find((initial) => initial.client === row.client))),
    [attendanceRows, initialRows],
  );

  const filteredRows = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return attendanceRows.filter((row) => {
      const matchesSearch = !query || [row.client_name, row.client_phone, row.client_parent_name].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesStatus = !statusFilter || (statusFilter === 'none' ? !row.status : row.status === statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [attendanceRows, studentSearch, statusFilter]);

  const loadLessons = async () => {
    setLessonsLoading(true);
    try {
      const params = { date: selectedDate, ...lessonFilters };
      Object.keys(params).forEach((key) => {
        if (!params[key]) delete params[key];
      });
      const { data } = await api.get('attendance/day/', { params });
      const items = (data.items || []).sort((left, right) => String(left.start_time || '').localeCompare(String(right.start_time || '')));
      setLessons(items);
      if (selectedLesson && !items.some((lesson) => lesson.lesson_id === selectedLesson.id)) {
        setSelectedLesson(null);
        setAttendanceRows([]);
        setInitialRows([]);
      }
    } catch (error) {
      showApiError(error);
      setLessons([]);
    } finally {
      setLessonsLoading(false);
    }
  };

  const loadAttendance = async (lesson, preserveChanges = false) => {
    if (!lesson?.id) return;
    setAttendanceLoading(true);
    try {
      const { data } = await api.get(`lessons/${lesson.id}/attendance/`);
      const serverRows = normalizeRows(data.items || data.students || []);
      let rows = serverRows;
      if (preserveChanges) {
        const changedByClient = new Map(dirtyRows.map((row) => [row.client, row]));
        rows = rows.map((row) => changedByClient.has(row.client) ? changedByClient.get(row.client) : row);
      }
      setSelectedLesson(data.lesson || lesson);
      setAttendanceRows(rows);
      setInitialRows(serverRows);
    } catch (error) {
      showApiError(error);
    } finally {
      setAttendanceLoading(false);
    }
  };

  const openDayItem = async (item) => {
    try {
      let lesson = item;
      if (item.type === 'schedule_slot') {
        const { data } = await api.post(`schedule-slots/${item.schedule_slot_id}/ensure-lesson/`, { date: selectedDate });
        lesson = data.lesson;
        await loadLessons();
      } else if (item.lesson_id) {
        lesson = { ...item, id: item.lesson_id };
      }
      await loadAttendance(lesson);
    } catch (error) {
      showApiError(error);
    }
  };

  useEffect(() => {
    if (mode === 'journal') loadLessons();
  }, [selectedDate, mode, JSON.stringify(lessonFilters)]);

  useEffect(() => {
    if (!initialLesson) return;
    api.get(`lessons/${initialLesson}/`)
      .then(({ data }) => {
        setSelectedDate(data.lesson_date);
        if (data.group) setLessonFilters((current) => ({ ...current, group: String(data.group) }));
        return loadAttendance(data);
      })
      .catch(showApiError);
  }, [initialLesson]);

  const setRow = (clientId, patch) => {
    setAttendanceRows((current) => current.map((row) => (row.client === clientId ? { ...row, ...patch } : row)));
  };

  const setAllStatuses = (status) => {
    setAttendanceRows((current) => current.map((row) => ({ ...row, status })));
  };

  const resetChanges = () => {
    setAttendanceRows(initialRows);
  };

  const saveAttendance = async () => {
    if (!selectedLesson || !dirtyRows.length) return;
    setSavingAttendance(true);
    try {
      const items = dirtyRows
        .filter((row) => row.status)
        .map((row) => ({
          client: row.client,
          subscription: row.subscription || null,
          status: row.status,
          comment: row.comment || '',
        }));
      const { data } = await api.post(`lessons/${selectedLesson.id}/attendance/`, { items });
      const rows = normalizeRows(data.items || data.students || []);
      setSelectedLesson(data.lesson || selectedLesson);
      setAttendanceRows(rows);
      setInitialRows(rows);
      dispatchToast('Посещения сохранены.');
      await loadLessons();
      await historyCrud.reload();
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingAttendance(false);
    }
  };

  const openManualCreate = () => {
    setManualForm(emptyManualVisit);
    setManualOpen(true);
  };

  const openManualEdit = (row) => {
    setManualForm({
      ...row,
      client: row.client ? String(row.client) : '',
      subscription: row.subscription ? String(row.subscription) : '',
      teacher: row.teacher ? String(row.teacher) : '',
      visited_at: row.visited_at ? String(row.visited_at).slice(0, 10) : '',
      notes: row.notes || '',
    });
    setManualOpen(true);
  };

  const saveManualVisit = async () => {
    const payload = {
      ...manualForm,
      client: manualForm.client || null,
      subscription: manualForm.subscription || null,
      teacher: manualForm.teacher || null,
      visited_at: manualForm.visited_at ? `${manualForm.visited_at}T00:00` : null,
    };
    try {
      if (manualForm.id) await api.patch(`visits/${manualForm.id}/`, payload);
      else await api.post('visits/', payload);
      setManualOpen(false);
      await historyCrud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const openStudentModal = () => {
    if (!selectedLesson || !canAddStudent) return;
    setStudentForm(emptyStudentVisit);
    setStudentModalOpen(true);
  };

  const addStudentToLesson = async () => {
    if (!selectedLesson || !studentForm.client) return;
    setAddingStudent(true);
    try {
      const { data } = await api.post(`lessons/${selectedLesson.id}/add-student/`, {
        client: studentForm.client,
        status: studentForm.status,
        comment: studentForm.comment || '',
      });
      setStudentModalOpen(false);
      await loadAttendance(selectedLesson, true);
      dispatchToast(data.message || 'Ученик добавлен в занятие.');
      await historyCrud.reload();
    } catch (error) {
      showApiError(error);
    } finally {
      setAddingStudent(false);
    }
  };

  return (
    <>
      <PageHeader title="Журнал учёта посещений" actionLabel={mode === 'classic' && canEdit ? '+ Добавить' : undefined} onAction={mode === 'classic' && canEdit ? openManualCreate : undefined}>
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          {modeOptions.map((item) => (
            <button key={item.value} type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === item.value ? 'bg-brand text-white' : 'text-slate-600 hover:text-brand'}`} onClick={() => setMode(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {mode === 'journal' ? (
        <>
          <div className="grid max-w-full gap-6 xl:grid-cols-[360px_1fr]">
            <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
              <div className="mb-4 grid gap-3">
                <Input label="Дата" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                <SelectField label="Группа" value={lessonFilters.group} onChange={(value) => setLessonFilters({ ...lessonFilters, group: value })} options={[{ value: '', label: 'Все группы' }, ...groupOptions]} />
                <SelectField label="Преподаватель" value={lessonFilters.teacher} onChange={(value) => setLessonFilters({ ...lessonFilters, teacher: value })} options={[{ value: '', label: 'Все преподаватели' }, ...teacherOptions]} />
              </div>
              <div className="mb-4 flex items-center justify-between gap-2">
                <Button variant="secondary" className="h-10 w-10 rounded-xl p-0" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="Предыдущий день">
                  <ChevronLeft size={16} />
                </Button>
                <div className="text-center">
                  <p className="text-xs font-bold uppercase text-slate-400">Дата</p>
                  <p className="font-bold text-slate-900">{parseLocalDate(selectedDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                <Button variant="secondary" className="h-10 w-10 rounded-xl p-0" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="Следующий день">
                  <ChevronRight size={16} />
                </Button>
              </div>
              <Button variant="accent" className="mb-4 w-full" onClick={() => setSelectedDate(isoDate(new Date()))}>
                <CalendarDays size={16} />
                Сегодня
              </Button>

              <div className="overflow-hidden rounded-2xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-3">№</th>
                      <th className="px-3 py-3">Время</th>
                      <th className="px-3 py-3">Занятие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessonsLoading ? (
                      <tr><td colSpan={3} className="px-3 py-8 text-center font-semibold text-slate-500">Загрузка...</td></tr>
                    ) : lessons.length === 0 ? (
                      <tr><td colSpan={3} className="px-3 py-8 text-center font-semibold text-slate-500">На эту дату занятий нет. Создайте расписание или сгенерируйте уроки.</td></tr>
                    ) : (
                      lessons.map((lesson, index) => (
                        <tr key={lesson.id}>
                          <td className="border-t border-slate-100 px-3 py-2 text-slate-500">{index + 1}</td>
                          <td className="border-t border-slate-100 px-3 py-2 font-bold text-slate-900">{lesson.start_time?.slice(0, 5) || '--:--'}</td>
                          <td className="border-t border-slate-100 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => openDayItem(lesson)}
                              className={`w-full rounded-xl px-3 py-2 text-left font-semibold transition ${selectedLesson?.id === lesson.lesson_id ? 'bg-brand text-white' : 'text-slate-700 hover:bg-brand/5 hover:text-brand'}`}
                            >
                              <span className="block">{lesson.group_name || lessonTitle(lesson)}</span>
                              <span className={`block text-xs ${selectedLesson?.id === lesson.id ? 'text-white/80' : 'text-slate-400'}`}>{lesson.subject_name || 'Без предмета'}</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="min-w-0 rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
              {!selectedLesson ? (
                <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center">
                  <div>
                    <Search className="mx-auto text-slate-300" size={42} />
                    <p className="mt-3 text-lg font-bold text-slate-800">Выберите занятие</p>
                  </div>
                </div>
              ) : (
                <AttendanceJournal
                  lesson={selectedLesson}
                  rows={filteredRows}
                  allRows={attendanceRows}
                  loading={attendanceLoading}
                  dirtyCount={dirtyRows.length}
                  saving={savingAttendance}
                  canEdit={canEdit}
                  onSetRow={setRow}
                  onSetAll={setAllStatuses}
                  onReset={resetChanges}
                  onSave={saveAttendance}
                  onAddStudent={openStudentModal}
                  canAddStudent={canAddStudent}
                  studentSearch={studentSearch}
                  onStudentSearch={setStudentSearch}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                />
              )}
            </section>
          </div>
        </>
      ) : (
        <ClassicVisits
          crud={historyCrud}
          clientOptions={clientOptions}
          groupOptions={groupOptions}
          employeeOptions={employeeOptions}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={openManualEdit}
        />
      )}

      <ManualVisitModal
        open={manualOpen}
        form={manualForm}
        setForm={setManualForm}
        onClose={() => setManualOpen(false)}
        onSave={saveManualVisit}
        clientOptions={clientOptions}
        employeeOptions={employeeOptions}
        subscriptionOptions={subscriptionOptions}
        loadingSubscriptions={loadingSubscriptions}
        selectedClient={selectedClient}
      />
      <AddStudentModal
        open={studentModalOpen}
        form={studentForm}
        setForm={setStudentForm}
        onClose={() => setStudentModalOpen(false)}
        onSave={addStudentToLesson}
        clientOptions={clientOptions}
        lesson={selectedLesson}
        saving={addingStudent}
      />
    </>
  );
}

function AttendanceJournal({
  lesson, rows, allRows, loading, dirtyCount, saving, canEdit, onSetRow, onSetAll, onReset, onSave,
  onAddStudent, canAddStudent, studentSearch, onStudentSearch, statusFilter, onStatusFilter,
}) {
  const header = [lesson.group_name, lesson.subject_name, timeRange(lesson), lesson.teacher_name].filter(Boolean).join(' / ');

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-900">{header || lessonTitle(lesson)}</h3>
          <p className="mt-1 text-sm text-slate-500">Всего учеников: {allRows.length}</p>
        </div>
        <Button onClick={onSave} disabled={!canEdit || saving || !dirtyCount}>
          <Save size={16} />
          {saving ? 'Сохранение...' : `Сохранить табель${dirtyCount ? ` (${dirtyCount})` : ''}`}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onSetAll('attended')} disabled={!canEdit}><UserCheck size={16} />Всех отметить Посетил</Button>
        <Button variant="secondary" onClick={() => onSetAll('missed')} disabled={!canEdit}><UserX size={16} />Всех отметить Пропуск</Button>
        <Button variant="ghost" onClick={onReset} disabled={!dirtyCount}><RotateCcw size={16} />Очистить изменения</Button>
        {canAddStudent && (
          <Button variant="secondary" onClick={onAddStudent}><Plus size={16} />Добавить ученика</Button>
        )}
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <Input label="Поиск по ученику" value={studentSearch} onChange={(event) => onStudentSearch(event.target.value)} placeholder="ФИО, телефон, родитель" />
        <SelectField label="Статус" value={statusFilter} onChange={onStatusFilter} options={journalStatusOptions} />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8 text-center font-semibold text-slate-500">Загрузка учеников...</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-100 md:block">
            <table className="min-w-[920px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-100 px-4 py-3">№</th>
                  <th className="border-b border-slate-100 px-4 py-3">Ученик</th>
                  <th className="border-b border-slate-100 px-4 py-3">Абонемент</th>
                  <th className="border-b border-slate-100 px-4 py-3">Осталось занятий</th>
                  <th className="border-b border-slate-100 px-4 py-3">Посетил</th>
                  <th className="border-b border-slate-100 px-4 py-3">Болел</th>
                  <th className="border-b border-slate-100 px-4 py-3">Пропуск</th>
                  <th className="border-b border-slate-100 px-4 py-3">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center font-semibold text-slate-500">Ученики не найдены</td></tr>
                ) : rows.map((row, index) => (
                  <tr key={row.client} className={row.dirty ? 'bg-amber-50/40' : ''}>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-500">{index + 1}</td>
                    <td className="border-b border-slate-100 px-4 py-3">
                      <p className="font-bold text-slate-900">{row.client_name}</p>
                      <p className="text-xs text-slate-500">{[row.client_parent_name, row.client_phone].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3">{row.subscription_title || 'Без абонемента'}</td>
                    <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-900">{row.remaining_lessons ?? '-'}</td>
                    <StatusCell active={row.status === 'attended'} disabled={!canEdit} onClick={() => onSetRow(row.client, { status: 'attended' })}>Посетил</StatusCell>
                    <StatusCell active={row.status === 'sick'} disabled={!canEdit} onClick={() => onSetRow(row.client, { status: 'sick' })}>Болел</StatusCell>
                    <StatusCell active={row.status === 'missed'} disabled={!canEdit} onClick={() => onSetRow(row.client, { status: 'missed' })}>Пропуск</StatusCell>
                    <td className="border-b border-slate-100 px-4 py-3">
                      <Input label="" value={row.comment || ''} disabled={!canEdit} onChange={(event) => onSetRow(row.client, { comment: event.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center font-semibold text-slate-500">Ученики не найдены</div>
            ) : rows.map((row) => (
              <div key={row.client} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="font-bold text-slate-900">{row.client_name}</p>
                <p className="mt-1 text-xs text-slate-500">{row.subscription_title || 'Без абонемента'} / Осталось: {row.remaining_lessons ?? '-'}</p>
                <div className="mt-3 flex gap-2">
                  <StatusButton active={row.status === 'attended'} variant="border-brand bg-brand text-white" icon={UserCheck} onClick={() => onSetRow(row.client, { status: 'attended' })}>Посетил</StatusButton>
                  <StatusButton active={row.status === 'sick'} variant="border-amber-500 bg-amber-500 text-white" icon={Thermometer} onClick={() => onSetRow(row.client, { status: 'sick' })}>Болел</StatusButton>
                  <StatusButton active={row.status === 'missed'} variant="border-red-600 bg-red-600 text-white" icon={UserX} onClick={() => onSetRow(row.client, { status: 'missed' })}>Пропуск</StatusButton>
                </div>
                <div className="mt-3">
                  <Input label="Комментарий" value={row.comment || ''} disabled={!canEdit} onChange={(event) => onSetRow(row.client, { comment: event.target.value })} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusCell({ active, disabled, onClick, children }) {
  return (
    <td className="border-b border-slate-100 px-4 py-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`min-h-10 w-full rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
          active ? 'border-brand bg-brand text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5 hover:text-brand'
        }`}
      >
        {active && <Check className="mr-1 inline" size={15} />}
        {children}
      </button>
    </td>
  );
}

function ClassicVisits({ crud, clientOptions, groupOptions, employeeOptions, canEdit, canDelete, onEdit }) {
  return (
    <>
      <Filters>
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(event) => crud.setFilters({ ...crud.filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(event) => crud.setFilters({ ...crud.filters, date_to: event.target.value })} />
        <SelectField label="Ученик" value={crud.filters.client} onChange={(value) => crud.setFilters({ ...crud.filters, client: value })} options={[{ value: '', label: 'Все' }, ...clientOptions]} />
        <SelectField label="Группа" value={crud.filters.group} onChange={(value) => crud.setFilters({ ...crud.filters, group: value })} options={[{ value: '', label: 'Все' }, ...groupOptions]} />
        <SelectField label="Учитель" value={crud.filters.teacher} onChange={(value) => crud.setFilters({ ...crud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...employeeOptions]} />
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, ...visitStatusOptions]} />
        <Input label="Абонемент" value={crud.filters.subscription} onChange={(event) => crud.setFilters({ ...crud.filters, subscription: event.target.value })} />
      </Filters>
      <Table
        data={crud.items}
        columns={[
          { key: 'date', header: 'Дата', render: (row) => dateTime(row.visited_at) },
          { key: 'client', header: 'Ученик', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || 'Клиент'}</Link> },
          { key: 'client_phone', header: 'Телефон', render: (row) => row.client_phone || '-' },
          { key: 'group_name', header: 'Группа', render: (row) => row.group_name || '-' },
          { key: 'lesson_display', header: 'Урок', render: (row) => row.lesson_display || row.lesson_title || '-' },
          { key: 'teacher_name', header: 'Учитель', render: (row) => row.teacher_name || '-' },
          { key: 'subscription_title', header: 'Абонемент', render: (row) => row.subscription_title || '-' },
          { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{statusLabel(row.status)}</Badge> },
          { key: 'lesson_deducted', header: 'Списано', render: (row) => <Badge value={row.lesson_deducted ? 'attended' : 'cancelled'}>{row.lesson_deducted ? 'Да' : 'Нет'}</Badge> },
          { key: 'notes', header: 'Комментарий', render: (row) => row.notes || '-' },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => onEdit(row)} onDelete={() => crud.remove(row.id)} /> },
        ]}
      />
    </>
  );
}

function AddStudentModal({ open, form, setForm, onClose, onSave, clientOptions, lesson, saving }) {
  if (!lesson) return null;
  const lessonDate = lesson.lesson_date
    ? parseLocalDate(lesson.lesson_date).toLocaleDateString('ru-RU')
    : '';
  const description = [
    lesson.subject_name,
    lesson.group_name,
    lessonDate,
    timeRange(lesson),
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      title="Добавить ученика в занятие"
      open={open}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={onSave} disabled={!form.client || saving}>
            {saving ? 'Добавление...' : 'Добавить ученика'}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <div className="rounded-2xl border border-brand/10 bg-brand/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Занятие</p>
          <p className="mt-1 font-semibold text-slate-900">{description}</p>
        </div>
        <ClientSelectWithCreate
          label="Ученик"
          value={form.client}
          onChange={(value) => setForm({ ...form, client: value })}
          options={clientOptions}
          placeholder="Выберите ученика"
        />
        <SelectField
          label="Статус"
          value={form.status}
          onChange={(value) => setForm({ ...form, status: value })}
          options={visitStatusOptions.filter((item) => ['attended', 'sick', 'missed'].includes(item.value))}
        />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Комментарий
          <textarea
            className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={form.comment}
            onChange={(event) => setForm({ ...form, comment: event.target.value })}
          />
        </label>
      </div>
    </Modal>
  );
}

function ManualVisitModal({ open, form, setForm, onClose, onSave, clientOptions, employeeOptions, subscriptionOptions, loadingSubscriptions, selectedClient }) {
  return (
    <Modal
      title="Посещение"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={onSave}>Сохранить</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ClientSelectWithCreate
          label="Ученик"
          value={form.client || ''}
          onChange={(value) => setForm({ ...form, client: value, subscription: '' })}
          options={clientOptions}
          placeholder="Выберите ученика"
        />
        <SelectField
          label="Абонемент"
          value={form.subscription || ''}
          onChange={(value) => setForm({ ...form, subscription: value })}
          options={[
            { value: '', label: selectedClient ? (loadingSubscriptions ? 'Загрузка абонементов...' : 'Без абонемента') : 'Сначала выберите ученика' },
            ...subscriptionOptions,
          ]}
        />
        <SelectField label="Учитель" value={form.teacher || ''} onChange={(value) => setForm({ ...form, teacher: value })} options={[{ value: '', label: 'Не выбран' }, ...employeeOptions]} />
        <Input label="Дата занятия" type="date" value={form.visited_at || ''} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
        <SelectField label="Статус" value={form.status || 'attended'} onChange={(value) => setForm({ ...form, status: value })} options={visitStatusOptions} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
          Комментарий
          <textarea
            className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={form.notes || ''}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>
      </div>
    </Modal>
  );
}
