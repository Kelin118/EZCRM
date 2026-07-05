import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, RotateCcw, Save, UserCheck, UserX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageVisits, getStoredUser } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import { Actions, Badge, Filters, Input, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { subscriptionLabel, useClientOptions, useEmployeeOptions, useLookup, useRoomOptions, useStudyGroupOptions } from './lookupUtils.jsx';

const emptyManualVisit = {
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

const lessonStatusOptions = [
  { value: '', label: 'Все' },
  { value: 'planned', label: 'Запланирован' },
  { value: 'completed', label: 'Проведен' },
  { value: 'cancelled', label: 'Отменен' },
];

const tabs = [
  { value: 'calendar', label: 'Календарь' },
  { value: 'today', label: 'Сегодня' },
  { value: 'history', label: 'История' },
];

const periodOptions = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
];

const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad = (value) => String(value).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseLocalDate = (value) => {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
};
const addDays = (date, count) => {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
};
const startOfWeek = (date) => addDays(date, -((date.getDay() + 6) % 7));
const endOfWeek = (date) => addDays(startOfWeek(date), 6);
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const sameDay = (left, right) => isoDate(left) === isoDate(right);
const dateLabel = (value) => (value ? parseLocalDate(value).toLocaleDateString('ru-RU') : '-');
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '-');
const timeRange = (lesson) => `${lesson.start_time?.slice(0, 5) || '--:--'}-${lesson.end_time?.slice(0, 5) || '--:--'}`;
const statusLabel = (value) => visitStatusOptions.find((item) => item.value === value)?.label || value || '-';
const lessonStatusLabel = (lesson) => lesson.status_display || lessonStatusOptions.find((item) => item.value === lesson.status)?.label || lesson.status || '-';

function periodBounds(anchorDate, view) {
  if (view === 'day') return { from: anchorDate, to: anchorDate };
  if (view === 'week') return { from: startOfWeek(anchorDate), to: endOfWeek(anchorDate) };
  return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
}

function periodTitle(anchorDate, view) {
  const { from, to } = periodBounds(anchorDate, view);
  if (view === 'day') return from.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'week') return `${from.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} - ${to.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return anchorDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function shiftPeriod(anchorDate, view, direction) {
  if (view === 'day') return addDays(anchorDate, direction);
  if (view === 'week') return addDays(anchorDate, direction * 7);
  return new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, 1);
}

function makeMonthDays(anchorDate) {
  const first = startOfWeek(startOfMonth(anchorDate));
  const last = endOfWeek(endOfMonth(anchorDate));
  const days = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    days.push(new Date(day));
  }
  return days;
}

function lessonsByDate(lessons) {
  return lessons.reduce((acc, lesson) => {
    const key = lesson.lesson_date;
    acc[key] = acc[key] || [];
    acc[key].push(lesson);
    return acc;
  }, {});
}

function LessonCard({ lesson, compact = false, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lesson)}
      className="w-full rounded-[18px] border border-slate-100 bg-white p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand/20 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{timeRange(lesson)}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">{lesson.group_name || 'Без группы'}</p>
        </div>
        <Badge value={lesson.status}>{lessonStatusLabel(lesson)}</Badge>
      </div>
      {!compact && (
        <div className="mt-3 grid gap-1 text-xs text-slate-500">
          <span>{lesson.subject_name || 'Без предмета'}</span>
          <span>{lesson.teacher_name || 'Без учителя'}</span>
          <span>{lesson.room_name || 'Без кабинета'}</span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">
        <span>{lesson.attended_count || 0}/{lesson.visits_count || 0} пришли</span>
        <span className="inline-flex items-center gap-1 text-brand"><ClipboardCheck size={14} />Отметить</span>
      </div>
    </button>
  );
}

function AttendanceModal({ lessonId, open, onClose, onSaved }) {
  const [lesson, setLesson] = useState(null);
  const [students, setStudents] = useState([]);
  const [initialStudents, setInitialStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const normalizeStudents = (items) => items.map((student) => ({
    ...student,
    subscription: student.visit?.subscription || student.subscription || '',
    status: student.status || '',
    comment: student.comment || '',
  }));

  const load = async () => {
    if (!lessonId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`lessons/${lessonId}/attendance/`);
      const normalized = normalizeStudents(data.students || []);
      setLesson(data.lesson);
      setStudents(normalized);
      setInitialStudents(normalized);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open, lessonId]);

  const setStudent = (clientId, patch) => {
    setStudents((current) => current.map((student) => (student.client === clientId ? { ...student, ...patch } : student)));
  };

  const setAllStatuses = (status) => {
    setStudents((current) => current.map((student) => ({ ...student, status })));
  };

  const resetChanges = () => {
    setStudents(initialStudents);
  };

  const save = async () => {
    setSaving(true);
    try {
      const items = students
        .filter((student) => student.status)
        .map((student) => ({
          client: student.client,
          subscription: student.subscription || null,
          status: student.status,
          comment: student.comment || '',
        }));
      const { data } = await api.post(`lessons/${lessonId}/attendance/`, { items });
      const normalized = normalizeStudents(data.students || []);
      setLesson(data.lesson);
      setStudents(normalized);
      setInitialStudents(normalized);
      onSaved?.();
      onClose();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Отметка посещений"
      open={open}
      onClose={onClose}
      size="full"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={saving || loading}><Save size={16} />Сохранить посещения</Button>
        </>
      }
    >
      {lesson && (
        <div className="mb-4 grid gap-3 rounded-[22px] border border-slate-100 bg-slate-50 p-4 md:grid-cols-6">
          <div><p className="text-xs font-bold uppercase text-slate-400">Группа</p><p className="mt-1 font-semibold text-slate-900">{lesson.group_name || '-'}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-400">Дата</p><p className="mt-1 font-semibold text-slate-900">{dateLabel(lesson.lesson_date)}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-400">Время</p><p className="mt-1 font-semibold text-slate-900">{timeRange(lesson)}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-400">Учитель</p><p className="mt-1 font-semibold text-slate-900">{lesson.teacher_name || '-'}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-400">Предмет</p><p className="mt-1 font-semibold text-slate-900">{lesson.subject_name || '-'}</p></div>
          <div><p className="text-xs font-bold uppercase text-slate-400">Кабинет</p><p className="mt-1 font-semibold text-slate-900">{lesson.room_name || '-'}</p></div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAllStatuses('attended')}><UserCheck size={16} />Всех отметить "Пришел"</Button>
        <Button variant="secondary" onClick={() => setAllStatuses('missed')}><UserX size={16} />Всех отметить "Не пришел"</Button>
        <Button variant="ghost" onClick={resetChanges}><RotateCcw size={16} />Очистить изменения</Button>
      </div>

      {loading ? (
        <div className="rounded-[22px] border border-slate-100 bg-white p-8 text-center font-semibold text-slate-500 shadow-card">Загрузка группы...</div>
      ) : (
        <Table
          data={students}
          empty="В группе нет активных учеников"
          columns={[
            { key: 'client_name', header: 'Ученик' },
            { key: 'client_phone', header: 'Телефон', render: (row) => row.client_phone || '-' },
            { key: 'subscription_title', header: 'Абонемент', render: (row) => row.subscription_title || 'Без абонемента' },
            { key: 'lessons_left', header: 'Остаток', render: (row) => row.lessons_left ?? '-' },
            {
              key: 'status',
              header: 'Статус',
              render: (row) => (
                <div className="flex min-w-64 flex-wrap items-center gap-2">
                  <Button variant={row.status === 'attended' ? 'primary' : 'secondary'} className="min-h-9 px-3 py-1.5" onClick={() => setStudent(row.client, { status: 'attended' })}><Check size={15} />Пришел</Button>
                  <Button variant={row.status === 'missed' ? 'danger' : 'secondary'} className="min-h-9 px-3 py-1.5" onClick={() => setStudent(row.client, { status: 'missed' })}><UserX size={15} />Не пришел</Button>
                  <SelectField label="" value={row.status || ''} onChange={(value) => setStudent(row.client, { status: value })} options={[{ value: '', label: 'Не отмечен' }, ...visitStatusOptions]} />
                </div>
              ),
            },
            {
              key: 'comment',
              header: 'Комментарий',
              render: (row) => <Input label="" value={row.comment || ''} onChange={(event) => setStudent(row.client, { comment: event.target.value })} />,
            },
          ]}
        />
      )}
    </Modal>
  );
}

export default function VisitsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('calendar');
  const [periodView, setPeriodView] = useState('week');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [lessonFilters, setLessonFilters] = useState({ group: '', teacher: '', status: '', room: '' });
  const [lessons, setLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const historyCrud = useCrudResource('visits/', { date_from: '', date_to: '', client: '', group: '', teacher: '', status: '', subscription: '' });
  const { clientOptions } = useClientOptions();
  const { groupOptions } = useStudyGroupOptions();
  const { employeeOptions } = useEmployeeOptions(['teacher', 'admin']);
  const { roomOptions } = useRoomOptions();
  const user = getStoredUser();
  const canEdit = canManageVisits(user);
  const canDelete = canDeleteDangerous(user);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualVisit);
  const selectedClient = manualForm.client || '';
  const { items: subscriptions, loading: loadingSubscriptions } = useLookup('subscriptions/', { client: selectedClient }, { enabled: Boolean(selectedClient) });
  const subscriptionOptions = useMemo(
    () => subscriptions.map((subscription) => ({ value: String(subscription.id), label: subscriptionLabel(subscription) })),
    [subscriptions],
  );

  const bounds = useMemo(() => periodBounds(anchorDate, periodView), [anchorDate, periodView]);
  const lessonsMap = useMemo(() => lessonsByDate(lessons), [lessons]);
  const todayIso = isoDate(new Date());

  const loadLessons = async () => {
    setLessonsLoading(true);
    try {
      const params = {
        date_from: isoDate(bounds.from),
        date_to: isoDate(bounds.to),
        ...lessonFilters,
      };
      Object.keys(params).forEach((key) => {
        if (!params[key]) delete params[key];
      });
      const { data } = await api.get('lessons/', { params });
      const items = Array.isArray(data) ? data : data.results || [];
      setLessons(items.sort((left, right) => `${left.lesson_date} ${left.start_time}`.localeCompare(`${right.lesson_date} ${right.start_time}`)));
    } catch (error) {
      showApiError(error);
      setLessons([]);
    } finally {
      setLessonsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calendar' || tab === 'today') loadLessons();
  }, [tab, bounds.from.getTime(), bounds.to.getTime(), JSON.stringify(lessonFilters)]);

  useEffect(() => {
    if (tab === 'today') {
      setPeriodView('day');
      setAnchorDate(new Date());
    }
  }, [tab]);

  const openLesson = (lesson) => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      navigate(`/lessons/${lesson.id}/attendance`);
      return;
    }
    setSelectedLesson(lesson);
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
      if (manualForm.id) {
        await api.patch(`visits/${manualForm.id}/`, payload);
      } else {
        await api.post('visits/', payload);
      }
      setManualOpen(false);
      await historyCrud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  const renderLessonFilters = () => (
    <Filters>
      <SelectField label="Группа" value={lessonFilters.group} onChange={(value) => setLessonFilters({ ...lessonFilters, group: value })} options={[{ value: '', label: 'Все' }, ...groupOptions]} />
      <SelectField label="Учитель" value={lessonFilters.teacher} onChange={(value) => setLessonFilters({ ...lessonFilters, teacher: value })} options={[{ value: '', label: 'Все' }, ...employeeOptions]} />
      <SelectField label="Статус урока" value={lessonFilters.status} onChange={(value) => setLessonFilters({ ...lessonFilters, status: value })} options={lessonStatusOptions} />
      <SelectField label="Кабинет" value={lessonFilters.room} onChange={(value) => setLessonFilters({ ...lessonFilters, room: value })} options={[{ value: '', label: 'Все' }, ...roomOptions]} />
    </Filters>
  );

  const renderCalendar = () => {
    if (periodView === 'day') {
      const dayLessons = lessonsMap[isoDate(anchorDate)] || [];
      return <LessonList lessons={dayLessons} loading={lessonsLoading} empty="Уроков за выбранный день нет" onOpen={openLesson} />;
    }

    if (periodView === 'week') {
      const days = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index));
      return (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((day) => {
            const items = lessonsMap[isoDate(day)] || [];
            return (
              <div key={isoDate(day)} className={`rounded-[22px] border bg-white p-3 shadow-card ${sameDay(day, new Date()) ? 'border-brand/30' : 'border-slate-100'}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">{weekdayLabels[(day.getDay() + 6) % 7]}</p>
                    <p className="font-bold text-slate-900">{day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{items.length}</span>
                </div>
                <div className="grid gap-2">
                  {items.length ? items.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} compact onOpen={openLesson} />) : <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs font-semibold text-slate-400">Нет уроков</p>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="grid gap-3 md:grid-cols-7">
        {weekdayLabels.map((day) => <div key={day} className="hidden text-center text-xs font-bold uppercase text-slate-400 md:block">{day}</div>)}
        {makeMonthDays(anchorDate).map((day) => {
          const items = lessonsMap[isoDate(day)] || [];
          const visibleItems = items.slice(0, 3);
          const outOfMonth = day.getMonth() !== anchorDate.getMonth();
          return (
            <div key={isoDate(day)} className={`rounded-[22px] border bg-white p-3 shadow-card ${outOfMonth ? 'opacity-60' : ''} ${sameDay(day, new Date()) ? 'border-brand/30' : 'border-slate-100'}`}>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold text-slate-900">{day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</p>
                <span className="md:hidden text-xs font-bold uppercase text-slate-400">{weekdayLabels[(day.getDay() + 6) % 7]}</span>
              </div>
              <div className="grid gap-2">
                {visibleItems.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} compact onOpen={openLesson} />)}
                {items.length > visibleItems.length && <p className="text-xs font-bold text-brand">+ еще {items.length - visibleItems.length}</p>}
                {!items.length && <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs font-semibold text-slate-400">Нет уроков</p>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Посещения" actionLabel={tab === 'history' && canEdit ? '+ Добавить вручную' : undefined} onAction={tab === 'history' && canEdit ? openManualCreate : undefined}>
        <div className="inline-flex flex-wrap rounded-2xl border border-slate-200 bg-white p-1">
          {tabs.map((item) => (
            <button key={item.value} type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === item.value ? 'bg-brand text-white' : 'text-slate-600 hover:text-brand'}`} onClick={() => setTab(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'calendar' && (
        <>
          <div className="mb-5 flex flex-col gap-3 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {periodOptions.map((item) => (
                <button key={item.value} type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${periodView === item.value ? 'bg-brand text-white' : 'text-slate-600'}`} onClick={() => setPeriodView(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setAnchorDate(shiftPeriod(anchorDate, periodView, -1))}><ChevronLeft size={16} />Назад</Button>
              <Button variant="accent" onClick={() => setAnchorDate(new Date())}><CalendarDays size={16} />Сегодня</Button>
              <Button variant="secondary" onClick={() => setAnchorDate(shiftPeriod(anchorDate, periodView, 1))}>Вперед<ChevronRight size={16} /></Button>
            </div>
            <p className="text-lg font-bold text-slate-900">{periodTitle(anchorDate, periodView)}</p>
          </div>
          {renderLessonFilters()}
          {lessonsLoading && <div className="mb-4 rounded-[22px] border border-slate-100 bg-white p-4 text-sm font-semibold text-slate-500 shadow-card">Загрузка уроков...</div>}
          {renderCalendar()}
        </>
      )}

      {tab === 'today' && (
        <>
          {renderLessonFilters()}
          <LessonList lessons={lessons.filter((lesson) => lesson.lesson_date === todayIso)} loading={lessonsLoading} empty="На сегодня уроков нет" onOpen={openLesson} />
        </>
      )}

      {tab === 'history' && (
        <>
          <Filters>
            <Input label="Дата от" type="date" value={historyCrud.filters.date_from} onChange={(event) => historyCrud.setFilters({ ...historyCrud.filters, date_from: event.target.value })} />
            <Input label="Дата до" type="date" value={historyCrud.filters.date_to} onChange={(event) => historyCrud.setFilters({ ...historyCrud.filters, date_to: event.target.value })} />
            <SelectField label="Ученик" value={historyCrud.filters.client} onChange={(value) => historyCrud.setFilters({ ...historyCrud.filters, client: value })} options={[{ value: '', label: 'Все' }, ...clientOptions]} />
            <SelectField label="Группа" value={historyCrud.filters.group} onChange={(value) => historyCrud.setFilters({ ...historyCrud.filters, group: value })} options={[{ value: '', label: 'Все' }, ...groupOptions]} />
            <SelectField label="Учитель" value={historyCrud.filters.teacher} onChange={(value) => historyCrud.setFilters({ ...historyCrud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...employeeOptions]} />
            <SelectField label="Статус" value={historyCrud.filters.status} onChange={(value) => historyCrud.setFilters({ ...historyCrud.filters, status: value })} options={[{ value: '', label: 'Все' }, ...visitStatusOptions]} />
            <Input label="Абонемент" value={historyCrud.filters.subscription} onChange={(event) => historyCrud.setFilters({ ...historyCrud.filters, subscription: event.target.value })} />
          </Filters>
          <Table
            data={historyCrud.items}
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
              { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => openManualEdit(row)} onDelete={() => historyCrud.remove(row.id)} /> },
            ]}
          />
        </>
      )}

      <AttendanceModal
        lessonId={selectedLesson?.id}
        open={Boolean(selectedLesson)}
        onClose={() => setSelectedLesson(null)}
        onSaved={() => {
          loadLessons();
          historyCrud.reload();
        }}
      />

      <Modal
        title="Посещение"
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>Отмена</Button>
            <Button onClick={saveManualVisit}>Сохранить</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Ученик" value={manualForm.client || ''} onChange={(value) => setManualForm({ ...manualForm, client: value, subscription: '' })} options={[{ value: '', label: 'Выберите ученика' }, ...clientOptions]} />
          <SelectField
            label="Абонемент"
            value={manualForm.subscription || ''}
            onChange={(value) => setManualForm({ ...manualForm, subscription: value })}
            options={[
              { value: '', label: selectedClient ? (loadingSubscriptions ? 'Загрузка абонементов...' : 'Без абонемента') : 'Сначала выберите ученика' },
              ...subscriptionOptions,
            ]}
          />
          <SelectField label="Учитель" value={manualForm.teacher || ''} onChange={(value) => setManualForm({ ...manualForm, teacher: value })} options={[{ value: '', label: 'Не выбран' }, ...employeeOptions]} />
          <Input label="Дата занятия" type="date" value={manualForm.visited_at || ''} onChange={(event) => setManualForm({ ...manualForm, visited_at: event.target.value })} />
          <SelectField label="Статус" value={manualForm.status || 'attended'} onChange={(value) => setManualForm({ ...manualForm, status: value })} options={visitStatusOptions} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
            Комментарий
            <textarea
              className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={manualForm.notes || ''}
              onChange={(event) => setManualForm({ ...manualForm, notes: event.target.value })}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}

function LessonList({ lessons, loading, empty, onOpen }) {
  if (loading) {
    return <div className="rounded-[22px] border border-slate-100 bg-white p-8 text-center font-semibold text-slate-500 shadow-card">Загрузка уроков...</div>;
  }

  if (!lessons.length) {
    return <div className="rounded-[22px] border border-dashed border-slate-200 bg-white p-8 text-center font-semibold text-slate-500 shadow-card">{empty}</div>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} onOpen={onOpen} />)}
    </div>
  );
}
