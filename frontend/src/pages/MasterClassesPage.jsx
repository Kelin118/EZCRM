import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import KanbanBoard from '../components/ui/KanbanBoard.jsx';
import KanbanCard from '../components/ui/KanbanCard.jsx';
import DiscountSelect from '../components/sales/DiscountSelect.jsx';
import PaymentSplitFields, { paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import { canDeleteDangerous, canManageSales, getStoredUser } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, normalizePayload, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import useDiscounts from '../hooks/useDiscounts.js';
import { calculateDiscountAmount, calculateDiscountedTotal } from '../utils/discounts.js';

const masterClassStages = [
  { value: 'lead', label: 'Лид' },
  { value: 'booked', label: 'Записался' },
  { value: 'attended', label: 'Пришел' },
  { value: 'paid', label: 'Оплатил' },
  { value: 'bought', label: 'Купил абонемент' },
  { value: 'lost', label: 'Не купил' },
];

const empty = {
  title: '',
  client: '',
  description: '',
  manager: '',
  teacher: '',
  starts_at: '',
  duration_minutes: 60,
  is_extra_work: false,
  stage: 'lead',
  payment_date: '',
  capacity: 0,
  price: 0,
  payment_amount: 0,
  discount: '',
  payment_parts: [],
  participants: [],
};

const baseFields = [
  { name: 'title', label: 'Предмет' },
  { name: 'starts_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'duration_minutes', label: 'Длительность, минут', type: 'number' },
  { name: 'stage', label: 'Этап', type: 'select', options: masterClassStages },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'capacity', label: 'Мест', type: 'number' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'payment_amount', label: 'Оплачено', type: 'number' },
  { name: 'description', label: 'Комментарий', type: 'textarea' },
];

const stageLabel = (value) => masterClassStages.find((stage) => stage.value === value)?.label || value || '—';
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
const eventDateTime = (value) => {
  if (!value) return { date: '—', time: '' };
  const date = new Date(value);
  return {
    date: date.toLocaleDateString('ru-RU'),
    time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
};
const dash = (value) => value || '—';
const clientDisplay = (item) => item.client_display_name || item.client_name || item.client?.display_name || item.client?.full_name || 'Не указан';
const clientSecondary = (item) => {
  const display = clientDisplay(item);
  if (!item.client_display_name || display === item.client_name) return item.client_phone || '';
  const parts = item.client_display_name.split(' · ').slice(1);
  return parts.join(' · ');
};
const masterClassColumnId = (item) => {
  if (item.stage === 'planned') return 'lead';
  if (item.stage === 'completed') return 'attended';
  if (item.stage === 'cancelled') return 'lost';
  return item.stage;
};

const isOutsideRegularHours = (value) => {
  if (!value) return false;
  const date = new Date(value);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes < 16 * 60 || minutes >= 21 * 60;
};

const assignmentEmployee = (assignment) => (assignment?.employee === null || assignment?.employee === undefined ? '' : String(assignment.employee));
const assignmentDuration = (assignment) => (assignment?.duration_minutes === null || assignment?.duration_minutes === undefined || assignment?.duration_minutes === '' ? '' : assignment.duration_minutes);
const normalizeStaffAssignments = (item = {}) => {
  const source = Array.isArray(item.staff_assignments) && item.staff_assignments.length
    ? item.staff_assignments
    : (item.teacher ? [{ employee: item.teacher, role: 'lead', is_extra_work: Boolean(item.is_extra_work), duration_minutes: null }] : []);
  const sortedSource = [...source].sort((a, b) => (a.role === 'lead' ? 0 : 1) - (b.role === 'lead' ? 0 : 1));
  const normalized = sortedSource.map((assignment, index) => ({
    id: assignment.id,
    employee: assignmentEmployee(assignment),
    employee_name: assignment.employee_name,
    role: assignment.role || (index === 0 ? 'lead' : 'assistant'),
    is_extra_work: Boolean(assignment.is_extra_work),
    duration_minutes: assignmentDuration(assignment),
    full_duration: assignment.duration_minutes === null || assignment.duration_minutes === undefined || assignment.duration_minutes === '',
  }));
  if (!normalized.some((assignment) => assignment.role === 'lead')) {
    normalized.unshift({ employee: '', role: 'lead', is_extra_work: false, duration_minutes: '', full_duration: true });
  }
  return normalized;
};
const staffForDisplay = (item = {}) => normalizeStaffAssignments(item).filter((assignment) => assignment.employee);
const staffNames = (item = {}) => {
  const staff = staffForDisplay(item);
  const lead = staff.find((assignment) => assignment.role === 'lead') || staff[0];
  const assistants = staff.filter((assignment) => assignment !== lead);
  const leadName = lead?.employee_name || item.teacher_name || 'Не указан';
  const assistantNames = assistants.map((assignment) => assignment.employee_name).filter(Boolean);
  return { staff, leadName, assistantNames, extraCount: staff.filter((assignment) => assignment.is_extra_work).length };
};

function dispatchError(message) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      {[
        ['table', 'Таблица'],
        ['kanban', 'Канбан'],
      ].map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${value === mode ? 'bg-brand text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-brand'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MasterClassCard({ canEdit, item, onEdit, dragProps }) {
  const clientName = clientDisplay(item);
  const clientInfo = clientSecondary(item);
  const timeOutside = item.time_outside_regular_hours ?? item.outside_regular_hours ?? item.is_outside_regular_hours;
  const { leadName, assistantNames, extraCount } = staffNames(item);

  return (
    <KanbanCard draggable={canEdit} dragHandleLabel="Перетащить МК" {...dragProps}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{clientName}</p>
          {clientInfo && <p className="mt-1 text-xs font-medium text-slate-500">{clientInfo}</p>}
        </div>
        <div className="grid justify-items-end gap-1">
          <Badge value={item.stage}>{stageLabel(item.stage)}</Badge>
          {extraCount > 0 && <Badge value="outside">Вне времени МК · {extraCount}</Badge>}
          {!item.is_extra_work && timeOutside && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">Вне 16:00–21:00</span>}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Менеджер</dt><dd className="text-right font-medium">{dash(item.manager_name || item.manager)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата МК</dt><dd className="text-right font-medium">{dateTime(item.starts_at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Длительность</dt><dd className="text-right font-medium">{item.duration_minutes ? `${item.duration_minutes} мин` : 'Не указана'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Предмет</dt><dd className="text-right font-medium">{dash(item.title)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Мастер</dt><dd className="text-right font-medium">{leadName}{assistantNames.length ? ` +${assistantNames.length}` : ''}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата оплаты</dt><dd className="text-right font-medium">{dash(item.payment_date)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Сумма оплаты</dt><dd className="text-right font-semibold text-brand">{money(item.payment_amount)}</dd></div>
      </dl>
      {item.description && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{item.description}</p>}
      {canEdit && <Button variant="secondary" className="mt-3 w-full" onClick={onEdit}>Редактировать</Button>}
    </KanbanCard>
  );
}

export default function MasterClassesPage() {
  const crud = useCrudResource('master-classes/', { search: '', stage: '', event_date: '', manager: '', teacher: '', extra_work: '', outside_regular_hours: '', payment_date_from: '', payment_date_to: '', branch: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['admin', 'teacher']);
  const [viewMode, setViewMode] = useState('table');
  const [saving, setSaving] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null);
  const [payPreview, setPayPreview] = useState([]);
  const [unmarkedOutsideCount, setUnmarkedOutsideCount] = useState(0);
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const { getDiscountById } = useDiscounts({ branch: form.branch });
  const selectedDiscount = getDiscountById(form.discount);
  const formOutsideRegularHours = isOutsideRegularHours(form.starts_at);
  const staffAssignments = normalizeStaffAssignments(form);
  const discountAmount = calculateDiscountAmount(form.price, selectedDiscount);
  const totalAfterDiscount = calculateDiscountedTotal(form.price, selectedDiscount);
  const changeDiscount = (value) => {
    const discount = getDiscountById(value);
    setForm({ ...form, discount: value, payment_amount: calculateDiscountedTotal(form.price, discount) });
  };

  useEffect(() => {
    const params = { ...crud.filters, outside_regular_hours: 'true', extra_work: 'false' };
    Object.keys(params).forEach((key) => {
      if (params[key] === '' || params[key] === null || params[key] === undefined) delete params[key];
    });
    api.get('master-classes/', { params })
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data.results || [];
        setUnmarkedOutsideCount(items.length);
      })
      .catch(() => setUnmarkedOutsideCount(0));
  }, [crud.filters]);

  useEffect(() => {
    const assignments = normalizeStaffAssignments(form).filter((assignment) => assignment.employee);
    if (!assignments.length || !form.starts_at) {
      setPayPreview([]);
      return;
    }
    let mounted = true;
    api.post('master-classes/pay-preview/', {
      starts_at: form.starts_at,
      duration_minutes: form.duration_minutes || null,
      staff_assignments: assignments.map((assignment) => ({
        employee: Number(assignment.employee),
        is_extra_work: Boolean(assignment.is_extra_work),
        duration_minutes: assignment.full_duration ? null : Number(assignment.duration_minutes || 0),
      })),
    })
      .then(({ data }) => {
        if (mounted) setPayPreview(data.items || []);
      })
      .catch(() => {
        if (mounted) setPayPreview([]);
      });
    return () => { mounted = false; };
  }, [form.staff_assignments, form.teacher, form.is_extra_work, form.starts_at, form.duration_minutes]);

  const applyStaffAssignments = (assignments) => {
    const normalized = assignments.map((assignment, index) => ({
      ...assignment,
      employee: assignmentEmployee(assignment),
      role: index === 0 ? 'lead' : 'assistant',
      is_extra_work: Boolean(assignment.is_extra_work),
      duration_minutes: assignment.full_duration ? '' : assignmentDuration(assignment),
      full_duration: Boolean(assignment.full_duration),
    }));
    const lead = normalized.find((assignment) => assignment.role === 'lead') || normalized[0];
    setForm({
      ...form,
      staff_assignments: normalized,
      teacher: lead?.employee || '',
      is_extra_work: normalized.some((assignment) => assignment.is_extra_work),
    });
  };

  const staffPayload = () => staffAssignments
    .map((assignment, index) => ({
      employee: Number(assignment.employee),
      role: index === 0 ? 'lead' : 'assistant',
      is_extra_work: Boolean(assignment.is_extra_work),
      duration_minutes: assignment.full_duration ? null : Number(assignment.duration_minutes || 0),
    }))
    .filter((assignment) => assignment.employee);
  const fields = [
    duplicateError && {
      name: 'duplicate_warning',
      type: 'custom',
      render: () => (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Похожая запись уже существует</p>
          <p className="mt-1">{[duplicateError.client_name, duplicateError.title, dateTime(duplicateError.starts_at)].filter(Boolean).join(' · ')}</p>
          <p className="mt-2 font-semibold">Измените дату или название МК.</p>
        </div>
      ),
    },
    baseFields[0],
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Выберите клиента' },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Не распределено' }, ...branchOptions] },
    { name: 'discount', type: 'custom', className: '', render: () => <DiscountSelect value={form.discount} onChange={changeDiscount} branch={form.branch} /> },
    { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
    baseFields[1],
    baseFields[2],
    {
      name: 'staff_assignments',
      type: 'custom',
      className: 'md:col-span-2',
      render: () => (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-black text-slate-900">Мастера</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Основной мастер и помощники этого МК. Дополнительный выход отмечается отдельно для каждого сотрудника.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => applyStaffAssignments([...staffAssignments, { employee: '', role: 'assistant', is_extra_work: false, duration_minutes: '', full_duration: true }])}
            >
              + Добавить мастера
            </Button>
          </div>
          <div className="mt-4 grid gap-3">
            {staffAssignments.map((assignment, index) => {
              const selectedEmployees = staffAssignments.map((item, itemIndex) => (itemIndex === index ? null : item.employee)).filter(Boolean);
              const options = teacherOptions.filter((option) => !selectedEmployees.includes(String(option.value)) || String(option.value) === String(assignment.employee));
              const preview = payPreview.find((item) => String(item.employee) === String(assignment.employee));
              return (
                <div key={assignment.id || index} className="rounded-2xl border border-white bg-white p-3 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <label className="grid gap-1.5 font-semibold text-slate-700">
                      {index === 0 ? 'Основной мастер' : 'Помощник'}
                      <select
                        value={assignment.employee}
                        onChange={(event) => applyStaffAssignments(staffAssignments.map((item, itemIndex) => (itemIndex === index ? { ...item, employee: event.target.value } : item)))}
                        className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
                      >
                        <option value="">Не выбран</option>
                        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    {index > 0 && (
                      <div className="flex items-end">
                        <Button variant="secondary" onClick={() => applyStaffAssignments(staffAssignments.filter((_, itemIndex) => itemIndex !== index))}>Удалить</Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(assignment.is_extra_work)}
                        onChange={(event) => applyStaffAssignments(staffAssignments.map((item, itemIndex) => (itemIndex === index ? { ...item, is_extra_work: event.target.checked } : item)))}
                      />
                      <span>
                        <span className="block font-bold">Дополнительный выход</span>
                        <span className="mt-1 block text-xs font-semibold">Учитывать для этого сотрудника как дополнительный выход.</span>
                      </span>
                    </label>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <label className="flex items-center gap-2 font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={assignment.full_duration}
                          onChange={(event) => applyStaffAssignments(staffAssignments.map((item, itemIndex) => (itemIndex === index ? { ...item, full_duration: event.target.checked, duration_minutes: event.target.checked ? '' : item.duration_minutes } : item)))}
                        />
                        Весь МК
                      </label>
                      {!assignment.full_duration && (
                        <Input
                          label="Длительность работы, минут"
                          type="number"
                          value={assignment.duration_minutes}
                          onChange={(event) => applyStaffAssignments(staffAssignments.map((item, itemIndex) => (itemIndex === index ? { ...item, duration_minutes: event.target.value } : item)))}
                        />
                      )}
                    </div>
                  </div>
                  {assignment.employee && preview && (
                    <div className={`mt-3 rounded-2xl p-3 text-sm ${preview.rate_configured ? 'bg-brand/5 text-slate-700' : 'bg-amber-50 text-amber-900'}`}>
                      <p className="font-bold">Предварительный расчёт оплаты</p>
                      {!preview.rate_configured ? (
                        <p className="mt-1">Ставка не настроена. Настройте ставку в разделе Сотрудники → Оплата труда.</p>
                      ) : (
                        <div className="mt-1 grid gap-1">
                          <p>Длительность: {preview.effective_duration_minutes || 0} мин</p>
                          {preview.pay_type === 'monthly' && <p>Оклад — обычное время входит в оклад.</p>}
                          <p>По графику: {money(preview.regular_amount)}</p>
                          <p>Вне графика сотрудника: {money(preview.outside_amount)}</p>
                          <p>Доплата за МК: {money(preview.extra_master_class_bonus)}</p>
                          <p className="font-black text-slate-900">Предварительно: {money(preview.estimated_total)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {formOutsideRegularHours && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="font-bold">Время вне стандартного окна МК</p>
              <p className="mt-1">Этот мастер-класс проходит вне обычного времени 16:00–21:00.</p>
              <Button className="mt-3" variant="secondary" onClick={() => applyStaffAssignments(staffAssignments.map((assignment) => ({ ...assignment, is_extra_work: true })))}>
                Отметить всех мастеров как дополнительный выход
              </Button>
            </div>
          )}
          {!formOutsideRegularHours && form.is_extra_work && (
            <p className="mt-4 rounded-2xl bg-brand/5 p-3 font-semibold text-slate-700">МК находится в стандартном времени, но один или несколько мастеров отмечены как дополнительный выход.</p>
          )}
        </section>
      ),
    },
    ...baseFields.slice(3),
    {
      name: 'price_summary',
      type: 'custom',
      render: () => (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          <p>Промежуточный итог: {money(form.price)}</p>
          <p className="text-emerald-700">Скидка: −{money(discountAmount)}</p>
          <p className="mt-1 text-base text-slate-900">Итого: {money(totalAfterDiscount)}</p>
        </div>
      ),
    },
    {
      name: 'payment_parts',
      type: 'custom',
      render: (current, update) => (
        <PaymentSplitFields
          totalAmount={current.payment_amount}
          value={current.payment_parts}
          onChange={(payment_parts) => update({ ...current, payment_parts })}
        />
      ),
    },
  ].filter(Boolean);
  const total = crud.items.reduce((sum, item) => sum + Number(item.payment_amount || 0), 0);

  const saveMasterClass = async () => {
    setDuplicateError(null);
    const assignments = staffPayload();
    if (assignments.some((assignment) => assignment.is_extra_work && !assignment.employee)) {
      dispatchError('Для дополнительного выхода выберите мастера.');
      return;
    }
    if (assignments.some((assignment) => {
      const effectiveDuration = assignment.duration_minutes ?? Number(form.duration_minutes || 0);
      return assignment.is_extra_work && Number(effectiveDuration || 0) <= 0;
    })) {
      dispatchError('Для дополнительного выхода укажите длительность МК.');
      return;
    }
    if (Number(form.payment_amount || 0) > 0 && paymentPartsTotal(form.payment_parts) !== Number(form.payment_amount || 0)) {
      dispatchError('Сумма оплат по способам должна совпадать с суммой оплаты.');
      return;
    }
    setSaving(true);
    try {
      const payload = normalizePayload({
        ...form,
        teacher: assignments.find((assignment) => assignment.role === 'lead')?.employee || null,
        is_extra_work: assignments.some((assignment) => assignment.is_extra_work),
        staff_assignments: assignments,
        payment_parts: paymentPartsPayload(form.payment_parts),
      });
      if (form.id) await api.patch(`master-classes/${form.id}/`, payload);
      else await api.post('master-classes/', payload);
      crud.setModalOpen(false);
      crud.setEditing(null);
      await crud.reload();
    } catch (error) {
      const duplicate = error.response?.data?.duplicate;
      if (duplicate) {
        setDuplicateError(duplicate);
        dispatchError('Такая запись уже существует. Измените дату или название МК.');
      } else {
        showApiError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const moveMasterClass = async (item, nextStage) => {
    if (!canEdit) return;
    const previousItems = crud.items;
    crud.setItems((items) => items.map((masterClass) => (masterClass.id === item.id ? { ...masterClass, stage: nextStage } : masterClass)));
    try {
      const { data } = await api.patch(`master-classes/${item.id}/`, { stage: nextStage });
      crud.setItems((items) => items.map((masterClass) => (masterClass.id === item.id ? { ...masterClass, ...data } : masterClass)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader title="Мастер-классы" actionLabel="Добавить МК" onAction={canEdit ? () => { setDuplicateError(null); crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено: {money(total)}</span>
        <Button variant="secondary" onClick={() => crud.setFilters({ ...crud.filters, extra_work: 'true' })}>Только вне времени</Button>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </PageHeader>
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, ...masterClassStages]} />
        <Input label="Дата проведения" type="date" value={crud.filters.event_date} onChange={(e) => crud.setFilters({ ...crud.filters, event_date: e.target.value })} />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <SelectField label="Мастер / преподаватель" value={crud.filters.teacher} onChange={(value) => crud.setFilters({ ...crud.filters, teacher: value })} options={[{ value: '', label: 'Все' }, ...teacherOptions]} />
        <SelectField label="Учёт времени" value={crud.filters.extra_work} onChange={(value) => crud.setFilters({ ...crud.filters, extra_work: value })} options={[{ value: '', label: 'Все' }, { value: 'false', label: 'Обычные' }, { value: 'true', label: 'Вне времени МК' }]} />
        <SelectField label="Время проведения" value={crud.filters.outside_regular_hours} onChange={(value) => crud.setFilters({ ...crud.filters, outside_regular_hours: value })} options={[{ value: '', label: 'Все' }, { value: 'false', label: 'В окне 16:00–21:00' }, { value: 'true', label: 'Вне 16:00–21:00' }]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      {unmarkedOutsideCount > 0 && (
        <section className="mb-5 flex flex-col gap-3 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-black">Неотмеченные МК вне стандартного времени: {unmarkedOutsideCount}</p>
            <p className="mt-1">Есть записи вне 16:00–21:00, которые не отмечены как дополнительный выход мастера.</p>
          </div>
          <Button variant="secondary" onClick={() => crud.setFilters({ ...crud.filters, outside_regular_hours: 'true', extra_work: 'false' })}>Показать</Button>
        </section>
      )}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={masterClassStages.map((stage) => ({ id: stage.value, title: stage.label }))}
          items={crud.items}
          getColumnId={masterClassColumnId}
          onMove={moveMasterClass}
          renderCard={(item, dragProps) => <MasterClassCard key={item.id} item={item} canEdit={canEdit} onEdit={() => { setDuplicateError(null); crud.setEditing(item); crud.setModalOpen(true); }} dragProps={dragProps} />}
        />
      ) : (
        <Table data={crud.items} columns={[
          { key: 'client', header: 'Клиент', render: (row) => (
            <div>
              <p className="font-semibold text-slate-900">{clientDisplay(row)}</p>
              {clientSecondary(row) && <p className="text-xs font-medium text-slate-500">{clientSecondary(row)}</p>}
            </div>
          ) },
          { key: 'title', header: 'Предмет' },
          { key: 'staff', header: 'Мастера', render: (row) => {
            const { leadName, assistantNames } = staffNames(row);
            return (
              <div className="text-sm">
                <p className="font-semibold text-slate-900">Основной: {leadName}</p>
                {assistantNames.length ? <p className="text-xs font-medium text-slate-500">Помощники: {assistantNames.join(', ')}</p> : null}
              </div>
            );
          } },
          { key: 'starts_at', header: 'Дата проведения МК', render: (row) => {
            const value = eventDateTime(row.starts_at);
            return <div><p className="font-semibold text-slate-900">{value.date}</p>{value.time && <p className="text-xs font-medium text-slate-500">{value.time}</p>}</div>;
          } },
          { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage}>{stageLabel(row.stage)}</Badge> },
          { key: 'time_kind', header: 'Учёт', render: (row) => {
            const timeOutside = row.time_outside_regular_hours ?? row.outside_regular_hours ?? row.is_outside_regular_hours;
            if (row.is_extra_work) return <Badge value="outside">Вне времени МК</Badge>;
            if (timeOutside) return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">Вне 16:00–21:00 · не отмечен</span>;
            return 'Обычный';
          } },
          { key: 'duration_minutes', header: 'Длительность', render: (row) => row.duration_minutes ? `${row.duration_minutes} мин` : 'Не указана' },
          { key: 'capacity', header: 'Мест' },
          { key: 'price', header: 'Цена', render: (row) => money(row.price) },
          { key: 'payment_amount', header: 'Оплачено', render: (row) => money(row.payment_amount) },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { setDuplicateError(null); crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
        ]} />
      )}
      <CrudModal title="Мастер-класс" open={crud.modalOpen} onClose={() => { setDuplicateError(null); crud.setModalOpen(false); }} fields={fields} form={form} setForm={setForm} saving={crud.saving || saving} onSubmit={saveMasterClass} />
    </>
  );
}
