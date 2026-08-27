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

const profileForTeacher = (profiles, teacherId) => profiles.find((profile) => String(profile.employee) === String(teacherId));

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

  return (
    <KanbanCard draggable={canEdit} {...dragProps}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{clientName}</p>
          {clientInfo && <p className="mt-1 text-xs font-medium text-slate-500">{clientInfo}</p>}
        </div>
        <div className="grid justify-items-end gap-1">
          <Badge value={item.stage}>{stageLabel(item.stage)}</Badge>
          {item.is_extra_work && <Badge value="outside">Вне времени МК</Badge>}
          {!item.is_extra_work && timeOutside && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">Вне 16:00–21:00</span>}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Менеджер</dt><dd className="text-right font-medium">{dash(item.manager_name || item.manager)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата МК</dt><dd className="text-right font-medium">{dateTime(item.starts_at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Длительность</dt><dd className="text-right font-medium">{item.duration_minutes ? `${item.duration_minutes} мин` : 'Не указана'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Предмет</dt><dd className="text-right font-medium">{dash(item.title)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Куратор</dt><dd className="text-right font-medium">{dash(item.teacher_name || item.teacher)}</dd></div>
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
  const [payrollProfiles, setPayrollProfiles] = useState([]);
  const [unmarkedOutsideCount, setUnmarkedOutsideCount] = useState(0);
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const { getDiscountById } = useDiscounts({ branch: form.branch });
  const selectedDiscount = getDiscountById(form.discount);
  const formOutsideRegularHours = isOutsideRegularHours(form.starts_at);
  const selectedTeacherOption = teacherOptions.find((item) => String(item.value) === String(form.teacher));
  const selectedPayrollProfile = profileForTeacher(payrollProfiles, form.teacher);
  const outsideRate = Number(selectedPayrollProfile?.outside_hourly_rate || 0);
  const extraBonus = Number(selectedPayrollProfile?.outside_master_class_bonus || 0);
  const extraDuration = Number(form.duration_minutes || 0);
  const hasExtraRate = Boolean(selectedPayrollProfile) && (outsideRate > 0 || extraBonus > 0);
  const extraWorkPreview = (extraDuration / 60) * outsideRate + extraBonus;
  const discountAmount = calculateDiscountAmount(form.price, selectedDiscount);
  const totalAfterDiscount = calculateDiscountedTotal(form.price, selectedDiscount);
  const changeDiscount = (value) => {
    const discount = getDiscountById(value);
    setForm({ ...form, discount: value, payment_amount: calculateDiscountedTotal(form.price, discount) });
  };

  useEffect(() => {
    api.get('employee-payroll-profiles/')
      .then(({ data }) => setPayrollProfiles(Array.isArray(data) ? data : data.results || []))
      .catch(() => setPayrollProfiles([]));
  }, []);

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
    { name: 'teacher', label: 'Мастер / преподаватель', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
    baseFields[1],
    baseFields[2],
    {
      name: 'is_extra_work',
      type: 'custom',
      className: 'md:col-span-2',
      render: () => (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-black">Учёт работы мастера</p>
          <label className="mt-3 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={Boolean(form.is_extra_work)}
              onChange={(event) => setForm({ ...form, is_extra_work: event.target.checked })}
            />
            <span>
              <span className="block font-bold">Вне времени мастер-классов</span>
              <span className="mt-1 block text-xs font-semibold text-amber-900/80">
                Отметьте, если мастер выходит на этот мастер-класс дополнительно. Запись будет учтена при расчёте дополнительной работы и зарплаты.
              </span>
            </span>
          </label>
          {formOutsideRegularHours && (
            <div className="mt-4 rounded-2xl bg-white/70 p-3">
              <p className="font-bold">Время вне стандартного окна МК</p>
              <p className="mt-1">Этот мастер-класс проходит вне обычного времени 16:00–21:00.</p>
              {!form.is_extra_work && (
                <Button className="mt-3" variant="secondary" onClick={() => setForm({ ...form, is_extra_work: true })}>
                  Отметить как дополнительный выход
                </Button>
              )}
            </div>
          )}
          {!formOutsideRegularHours && form.is_extra_work && (
            <p className="mt-4 rounded-2xl bg-white/70 p-3 font-semibold">МК находится в стандартном времени, но отмечен как дополнительный выход.</p>
          )}
          {form.is_extra_work && (
            <div className={`mt-4 rounded-2xl p-3 ${hasExtraRate ? 'bg-white/80' : 'bg-amber-100 text-amber-900'}`}>
              <p className="font-bold">Предварительный расчёт дополнительной работы</p>
              {!hasExtraRate ? (
                <p className="mt-1">Ставка дополнительной работы для этого мастера не настроена. Настройте ставку в разделе Сотрудники → Оплата труда.</p>
              ) : (
                <div className="mt-2 grid gap-1 text-sm">
                  <p>Мастер: {selectedTeacherOption?.label || 'Не выбран'}</p>
                  <p>Длительность: {extraDuration || 0} мин</p>
                  <p>Ставка дополнительной работы: {money(outsideRate)} / час</p>
                  <p>Доплата за МК: {money(extraBonus)}</p>
                  <p className="font-black text-slate-900">Предварительно: {money(extraWorkPreview)}</p>
                </div>
              )}
            </div>
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
    if (form.is_extra_work && !form.teacher) {
      dispatchError('Для дополнительного выхода выберите мастера.');
      return;
    }
    if (form.is_extra_work && Number(form.duration_minutes || 0) <= 0) {
      dispatchError('Для дополнительного выхода укажите длительность МК.');
      return;
    }
    if (Number(form.payment_amount || 0) > 0 && paymentPartsTotal(form.payment_parts) !== Number(form.payment_amount || 0)) {
      dispatchError('Сумма оплат по способам должна совпадать с суммой оплаты.');
      return;
    }
    setSaving(true);
    try {
      const payload = normalizePayload({ ...form, payment_parts: paymentPartsPayload(form.payment_parts) });
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
