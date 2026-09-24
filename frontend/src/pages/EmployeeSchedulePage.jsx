import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import {
  addCalendarDays, calendarWeekDates, calendarWeekStart, formatDisplayDate,
  formatWeekdayDate, formatWeekRange, todayLocalDate,
} from '../utils/dateTime.js';
import { Filters, Input, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const todayIso = () => todayLocalDate();
const emptyTemplate = {
  employee: '', branch: '', weekday: 0, weekdays: [0], start_time: '16:00', end_time: '21:00',
  is_working_day: true, effective_from: todayIso(),
};
const emptyShift = {
  employee: '', branch: '', shift_date: todayIso(), start_time: '16:00', end_time: '21:00',
  is_working_day: true, note: '', source: 'none', shift_id: null,
};

function sourceLabel(source) {
  if (source === 'override') return 'Индивидуальная смена';
  if (source === 'template') return 'По шаблону графика';
  return 'График не настроен';
}

export default function EmployeeSchedulePage() {
  const [tab, setTab] = useState('shifts');
  const [filters, setFilters] = useState({ employee: '', branch: 'all' });
  const [weekStart, setWeekStart] = useState(() => calendarWeekStart(todayIso()));
  const [resolvedItems, setResolvedItems] = useState([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftEditing, setShiftEditing] = useState(null);
  const [resettingShift, setResettingShift] = useState(null);
  const [templateItems, setTemplateItems] = useState([]);
  const [scheduleDate, setScheduleDate] = useState(todayIso);
  const [history, setHistory] = useState(null);
  const [templateEditing, setTemplateEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const { branchOptions, branchFilterOptions } = useBranches();
  const { employees, employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher', 'accountant']);
  const weekDates = useMemo(() => calendarWeekDates(weekStart), [weekStart]);

  const loadShifts = async () => {
    setShiftsLoading(true);
    try {
      const { data } = await api.get('employee-shifts/resolved/', {
        params: { ...filters, date_from: weekDates[0], date_to: weekDates[6] },
      });
      setResolvedItems(Array.isArray(data) ? data : data.results || []);
    } finally {
      setShiftsLoading(false);
    }
  };

  const loadTemplates = async () => {
    const { data } = await api.get('employee-schedules/', { params: { ...filters, effective_on: scheduleDate } });
    setTemplateItems(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    if (tab !== 'shifts' || weekDates.length !== 7) return;
    loadShifts().catch(showApiError);
  }, [tab, filters, weekStart]);

  useEffect(() => {
    if (tab !== 'templates') return;
    loadTemplates().catch(showApiError);
  }, [tab, filters, scheduleDate]);

  const shiftRows = useMemo(() => {
    const map = new Map();
    resolvedItems.forEach((item) => {
      const key = String(item.employee);
      if (!map.has(key)) map.set(key, { id: item.employee, employee: { id: item.employee, display_name: item.employee_name }, days: {} });
      map.get(key).days[item.shift_date] = item;
    });
    return Array.from(map.values());
  }, [resolvedItems]);

  const templateRows = useMemo(() => {
    const map = new Map();
    employees.forEach((employee) => map.set(String(employee.id), { id: employee.id, employee, days: Array(7).fill(null) }));
    templateItems.forEach((item) => {
      const key = String(item.employee);
      if (!map.has(key)) map.set(key, { id: item.employee, employee: { id: item.employee, display_name: item.employee_name }, days: Array(7).fill(null) });
      map.get(key).days[item.weekday] = item;
    });
    return Array.from(map.values()).filter((row) => !filters.employee || String(row.employee.id) === String(filters.employee));
  }, [employees, templateItems, filters.employee]);

  const openShiftCell = (item) => setShiftEditing({
    ...emptyShift,
    ...item,
    employee: String(item.employee),
    branch: item.branch ? String(item.branch) : '',
    start_time: item.start_time?.slice(0, 5) || '16:00',
    end_time: item.end_time?.slice(0, 5) || '21:00',
    is_working_day: item.is_working_day ?? true,
  });

  const openNewShift = () => setShiftEditing({
    ...emptyShift,
    employee: filters.employee || '',
    branch: filters.branch !== 'all' && filters.branch !== 'unassigned' ? filters.branch : '',
    shift_date: weekDates[0] >= todayIso() ? weekDates[0] : todayIso(),
  });

  const saveShift = async () => {
    setSaving(true);
    try {
      const payload = {
        employee: shiftEditing.employee,
        shift_date: shiftEditing.shift_date,
        branch: shiftEditing.branch || null,
        start_time: shiftEditing.is_working_day ? shiftEditing.start_time : null,
        end_time: shiftEditing.is_working_day ? shiftEditing.end_time : null,
        is_working_day: shiftEditing.is_working_day,
        note: shiftEditing.note || '',
      };
      await api.post('employee-shifts/set-for-date/', payload);
      const targetWeek = calendarWeekStart(shiftEditing.shift_date);
      setShiftEditing(null);
      if (targetWeek === weekStart) await loadShifts();
      else setWeekStart(targetWeek);
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const resetToTemplate = async () => {
    if (!resettingShift?.shift_id) return;
    setSaving(true);
    try {
      await api.delete(`employee-shifts/${resettingShift.shift_id}/`);
      setResettingShift(null);
      setShiftEditing(null);
      await loadShifts();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const openTemplateCell = (employee, weekday, item = null) => setTemplateEditing(item ? {
    ...item,
    employee: String(item.employee),
    branch: item.branch ? String(item.branch) : '',
    weekday,
    weekdays: [weekday],
    effective_from: scheduleDate >= todayIso() ? scheduleDate : todayIso(),
  } : {
    ...emptyTemplate,
    employee: String(employee.id),
    weekday,
    weekdays: [weekday],
    effective_from: scheduleDate >= todayIso() ? scheduleDate : todayIso(),
  });

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const payload = {
        employee: templateEditing.employee,
        weekdays: templateEditing.weekdays || [templateEditing.weekday],
        branch: templateEditing.branch || null,
        start_time: templateEditing.start_time,
        end_time: templateEditing.end_time,
        is_working_day: templateEditing.is_working_day,
        effective_from: templateEditing.effective_from,
      };
      await api.post('employee-schedules/set-from-date/', payload);
      setTemplateEditing(null);
      if (scheduleDate === templateEditing.effective_from) await loadTemplates();
      else setScheduleDate(templateEditing.effective_from);
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async () => {
    try {
      const { data } = await api.get('employee-schedules/', { params: { employee: filters.employee } });
      setHistory(Array.isArray(data) ? data : data.results || []);
    } catch (error) {
      showApiError(error);
    }
  };

  const toggleWeekday = (weekday) => {
    setTemplateEditing((current) => {
      const selected = Array.isArray(current.weekdays) ? current.weekdays : [current.weekday];
      const next = selected.includes(weekday) ? selected.filter((item) => item !== weekday) : [...selected, weekday].sort((a, b) => a - b);
      return { ...current, weekdays: next.length ? next : selected };
    });
  };

  const tabs = (
    <div role="tablist" aria-label="Раздел графика" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
      {[
        ['shifts', 'Смены'],
        ['templates', 'Шаблоны'],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${tab === value ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          onClick={() => setTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const shiftColumns = [
    {
      key: 'employee',
      header: 'Сотрудник',
      headerClassName: 'sticky left-0 z-20 bg-slate-50',
      cellClassName: 'sticky left-0 z-[5] min-w-44 bg-white font-semibold group-hover:bg-[#fbfdfb]',
      render: (row) => row.employee.display_name,
    },
    ...weekDates.map((date) => {
      const isToday = date === todayIso();
      return {
        key: date,
        align: 'center',
        headerClassName: isToday ? 'bg-amber-50/80' : '',
        cellClassName: isToday ? 'bg-amber-50/30' : '',
        header: (
          <span className="grid justify-items-center gap-0.5">
            <span>{formatWeekdayDate(date)}</span>
            {isToday && <span className="text-[10px] font-bold text-amber-700">Сегодня</span>}
          </span>
        ),
        render: (row) => {
          const item = row.days[date] || {
            employee: row.employee.id,
            employee_name: row.employee.display_name,
            shift_date: date,
            source: 'none',
            is_working_day: null,
          };
          const isOverride = item.source === 'override';
          const tone = item.source === 'none'
            ? 'border-dashed border-slate-200 bg-white text-slate-400 hover:border-brand/25 hover:bg-brand/5 hover:text-brand'
            : item.is_working_day
              ? isOverride ? 'border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300' : 'border-brand/20 bg-brand/10 text-brand hover:border-brand/35'
              : isOverride ? 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300' : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300';
          return (
            <button
              type="button"
              title={sourceLabel(item.source)}
              className={`min-h-14 w-full min-w-24 rounded-lg border px-2 py-2 text-center text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${tone}`}
              onClick={() => openShiftCell(item)}
            >
              <span className="block tabular-nums">
                {item.source === 'none' ? '—' : item.is_working_day ? `${item.start_time?.slice(0, 5)}–${item.end_time?.slice(0, 5)}` : 'Выходной'}
              </span>
              <span className={`mt-1 block text-[10px] font-semibold ${isOverride ? '' : 'opacity-65'}`}>
                {isOverride ? 'Индив.' : item.source === 'template' ? 'По шаблону' : 'Добавить'}
              </span>
            </button>
          );
        },
      };
    }),
  ];

  const shiftIsPast = Boolean(shiftEditing && shiftEditing.shift_date < todayIso());

  return (
    <>
      <PageHeader
        title="График сотрудников"
        description={tab === 'shifts' ? 'Рабочие смены на конкретные календарные даты.' : 'Шаблон применяется к датам, для которых не задана индивидуальная смена.'}
        tabs={tabs}
        actionLabel={tab === 'shifts' ? 'Добавить смену' : 'Добавить шаблон'}
        onAction={tab === 'shifts'
          ? openNewShift
          : () => setTemplateEditing({ ...emptyTemplate, employee: filters.employee || '', effective_from: todayIso() })}
      />

      <Filters>
        <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
        <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
        {tab === 'templates' && <Input label="График на дату" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />}
        {tab === 'templates' && <Button variant="secondary" onClick={openHistory}>История графика</Button>}
      </Filters>

      {tab === 'shifts' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="secondary" className="h-10 w-10 px-0" aria-label="Предыдущая неделя" title="Предыдущая неделя" onClick={() => setWeekStart(addCalendarDays(weekStart, -7))}>
                <ChevronLeft size={18} aria-hidden="true" />
              </Button>
              <Button variant="secondary" onClick={() => setWeekStart(calendarWeekStart(todayIso()))}>Сегодня</Button>
              <Button variant="secondary" className="h-10 w-10 px-0" aria-label="Следующая неделя" title="Следующая неделя" onClick={() => setWeekStart(addCalendarDays(weekStart, 7))}>
                <ChevronRight size={18} aria-hidden="true" />
              </Button>
            </div>
            <p className="text-base font-semibold text-slate-800 tabular-nums">{formatWeekRange(weekStart)}</p>
            <Input label="Перейти к дате" type="date" value={weekStart} onChange={(event) => setWeekStart(calendarWeekStart(event.target.value))} />
          </div>
          <Table columns={shiftColumns} data={shiftRows} loading={shiftsLoading} empty="Для выбранной недели нет сотрудников" />
        </>
      ) : (
        <Table
          data={templateRows}
          columns={[
            { key: 'employee', header: 'Сотрудник', render: (row) => row.employee.display_name || row.employee.full_name || row.employee.username },
            ...weekdays.map((label, index) => ({
              key: `day-${index}`,
              align: 'center',
              header: label,
              render: (row) => {
                const item = row.days[index];
                const tone = item
                  ? item.is_working_day
                    ? 'border-brand/20 bg-brand/10 text-brand hover:border-brand/35 hover:bg-brand/15'
                    : 'border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300'
                  : 'border-dashed border-slate-200 bg-white text-slate-400 hover:border-brand/25 hover:bg-brand/5 hover:text-brand';
                return (
                  <button type="button" className={`min-h-10 w-full rounded-lg border px-3 py-2 text-center text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${tone}`} onClick={() => openTemplateCell(row.employee, index, item)}>
                    {item ? (item.is_working_day ? `${item.start_time?.slice(0, 5)}–${item.end_time?.slice(0, 5)}` : 'Выходной') : '—'}
                  </button>
                );
              },
            })),
          ]}
        />
      )}

      <Modal
        title="Смена сотрудника"
        open={Boolean(shiftEditing)}
        onClose={() => setShiftEditing(null)}
        footer={shiftEditing && (
          <>
            {shiftEditing.source === 'override' && !shiftIsPast && (
              <Button variant="secondary" onClick={() => setResettingShift(shiftEditing)} disabled={saving}>
                <RotateCcw size={16} aria-hidden="true" /> Вернуть по шаблону
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShiftEditing(null)}>Закрыть</Button>
            {!shiftIsPast && <Button onClick={saveShift} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>}
          </>
        )}
      >
        {shiftEditing && (
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField disabled={Boolean(shiftEditing.shift_id) || shiftIsPast} label="Сотрудник" value={shiftEditing.employee} onChange={(employee) => setShiftEditing({ ...shiftEditing, employee })} options={employeeOptions} />
            <Input disabled={Boolean(shiftEditing.shift_id) || shiftIsPast} label="Дата" type="date" min={todayIso()} value={shiftEditing.shift_date} onChange={(event) => setShiftEditing({ ...shiftEditing, shift_date: event.target.value })} />
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm md:col-span-2">
              <span className="text-slate-500">Источник:</span> <strong className="text-slate-800">{sourceLabel(shiftEditing.source)}</strong>
              {shiftIsPast && <p className="mt-1 text-amber-700">Прошедшая смена доступна только для просмотра.</p>}
            </div>
            <SelectField disabled={shiftIsPast} label="Рабочий день" value={shiftEditing.is_working_day ? '1' : '0'} onChange={(value) => setShiftEditing({ ...shiftEditing, is_working_day: value === '1' })} options={[{ value: '1', label: 'Да' }, { value: '0', label: 'Нет' }]} />
            <SelectField disabled={shiftIsPast} label="Филиал" value={shiftEditing.branch || ''} onChange={(branch) => setShiftEditing({ ...shiftEditing, branch })} options={[{ value: '', label: 'По шаблону / без филиала' }, ...branchOptions]} />
            {shiftEditing.is_working_day && (
              <>
                <Input disabled={shiftIsPast} label="Начало" type="time" value={shiftEditing.start_time || ''} onChange={(event) => setShiftEditing({ ...shiftEditing, start_time: event.target.value })} />
                <Input disabled={shiftIsPast} label="Конец" type="time" value={shiftEditing.end_time || ''} onChange={(event) => setShiftEditing({ ...shiftEditing, end_time: event.target.value })} />
              </>
            )}
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
              <span>Комментарий</span>
              <textarea disabled={shiftIsPast} name="shift-note" rows="3" value={shiftEditing.note || ''} onChange={(event) => setShiftEditing({ ...shiftEditing, note: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-800 transition-[border-color,box-shadow] duration-150 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:bg-slate-50" />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        title="Вернуть смену по шаблону?"
        open={Boolean(resettingShift)}
        onClose={() => setResettingShift(null)}
        footer={<><Button variant="secondary" onClick={() => setResettingShift(null)}>Отмена</Button><Button variant="danger" onClick={resetToTemplate} disabled={saving}>Вернуть по шаблону</Button></>}
      >
        <p className="text-sm leading-6 text-slate-600">
          Индивидуальная смена на {formatDisplayDate(resettingShift?.shift_date)} будет удалена. Для этой даты снова применится недельный шаблон.
        </p>
      </Modal>

      <Modal title={templateEditing?.id ? 'Изменить шаблон' : 'Добавить шаблон'} open={Boolean(templateEditing)} onClose={() => setTemplateEditing(null)} footer={<><Button variant="secondary" onClick={() => setTemplateEditing(null)}>Отмена</Button><Button onClick={saveTemplate} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button></>}>
        {templateEditing && (
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Сотрудник" value={templateEditing.employee} onChange={(employee) => setTemplateEditing({ ...templateEditing, employee })} options={employeeOptions} />
            {templateEditing.id ? (
              <SelectField label="День недели" value={String(templateEditing.weekday)} onChange={(weekday) => setTemplateEditing({ ...templateEditing, weekday: Number(weekday), weekdays: [Number(weekday)] })} options={weekdays.map((label, index) => ({ value: String(index), label }))} />
            ) : (
              <div className="grid gap-2 md:col-span-2">
                <p className="text-sm font-semibold text-slate-700">Дни недели</p>
                <div className="flex flex-wrap gap-2">
                  {weekdays.map((label, index) => (
                    <label key={label} className={`flex min-h-10 items-center rounded-xl border px-4 py-2 text-sm font-bold ${templateEditing.weekdays?.includes(index) ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <input className="sr-only" type="checkbox" checked={templateEditing.weekdays?.includes(index) || false} onChange={() => toggleWeekday(index)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <SelectField label="Филиал" value={templateEditing.branch || ''} onChange={(branch) => setTemplateEditing({ ...templateEditing, branch })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
            <SelectField label="Рабочий день" value={templateEditing.is_working_day ? '1' : '0'} onChange={(value) => setTemplateEditing({ ...templateEditing, is_working_day: value === '1' })} options={[{ value: '1', label: 'Да' }, { value: '0', label: 'Нет' }]} />
            <Input label="Изменить шаблон с даты" type="date" min={todayIso()} value={templateEditing.effective_from} onChange={(event) => setTemplateEditing({ ...templateEditing, effective_from: event.target.value })} />
            <Input label="Начало" type="time" value={templateEditing.start_time?.slice(0, 5) || ''} onChange={(event) => setTemplateEditing({ ...templateEditing, start_time: event.target.value })} />
            <Input label="Конец" type="time" value={templateEditing.end_time?.slice(0, 5) || ''} onChange={(event) => setTemplateEditing({ ...templateEditing, end_time: event.target.value })} />
            <p className="text-sm text-slate-500 md:col-span-2">Прошлые периоды сохранятся. Новый шаблон начнёт действовать с выбранной даты.</p>
          </div>
        )}
      </Modal>

      <Modal title="История шаблонов" open={Boolean(history)} onClose={() => setHistory(null)} size="wide">
        {history && <Table data={history} columns={[
          { key: 'employee_name', header: 'Сотрудник' },
          { key: 'weekday', header: 'День', render: (row) => weekdays[row.weekday] },
          { key: 'hours', header: 'Время', render: (row) => row.is_working_day ? `${row.start_time?.slice(0, 5)}–${row.end_time?.slice(0, 5)}` : 'Выходной' },
          { key: 'valid_from', header: 'Действовал с' },
          { key: 'valid_until', header: 'Действовал до', render: (row) => row.valid_until || 'Сейчас' },
          { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || '—' },
        ]} />}
      </Modal>
    </>
  );
}
