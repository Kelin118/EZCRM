import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageSales, getStoredUser } from '../auth.js';
import Modal from '../components/ui/Modal.jsx';
import DiscountSelect from '../components/sales/DiscountSelect.jsx';
import SubscriptionAddonsSelect, { addonPayload, addonsTotal } from '../components/subscriptions/SubscriptionAddonsSelect.jsx';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions, useLookup } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import { calculateEndDateFromService } from '../utils/subscriptionDates.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';
import { todayLocalDate } from '../utils/dateTime.js';
import useDiscounts from '../hooks/useDiscounts.js';
import { calculateDiscountAmount, calculateDiscountedTotal } from '../utils/discounts.js';

const trialStages = [
  { value: 'lead', label: 'Лид' },
  { value: 'booked', label: 'Записался на пробный' },
  { value: 'attended', label: 'Прошел пробный' },
  { value: 'bought', label: 'Купил абонемент' },
  { value: 'lost', label: 'Не купил' },
];

const empty = { client: '', manager: '', teacher: '', scheduled_at: '', stage: 'lead', payment_date: '', price: 0, payment_method: '', bought_subscription: false, notes: '' };
const todayIso = todayLocalDate;

const emptyConvertForm = { service: '', addons: [], discount: '', subscription_type: '', start_date: todayIso(), end_date: '', total_visits: 0, price: 0, payment_amount: 0, payment_method: '', payment_date: todayIso(), comment: 'Купил после пробного' };
const boughtStages = new Set(['bought', 'purchased', 'subscription_bought']);

const baseFields = [
  { name: 'scheduled_at', label: 'Дата пробного', type: 'datetime-local' },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'stage', label: 'Этап', type: 'select', options: trialStages },
  { name: 'bought_subscription', label: 'Купил абонемент', type: 'select', options: [{ value: false, label: 'Нет' }, { value: true, label: 'Да' }] },
  { name: 'notes', label: 'Комментарий', type: 'textarea' },
];

const stageLabel = (value) => trialStages.find((stage) => stage.value === value)?.label || value || '-';
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '-');
const dash = (value) => value || '-';
const isBoughtStage = (value) => boughtStages.has(value);

function trialColumnId(item) {
  const stage = item.stage ?? item.status;
  if (stage === 'new') return 'lead';
  if (stage === 'scheduled') return 'booked';
  if (stage === 'completed') return 'attended';
  if (stage === 'cancelled') return 'lost';
  return stage;
}

function getStudentName(item) {
  return item.student_name || item.client_name || '-';
}

function getParentName(item) {
  return item.parent_name || item.client_parent_name || '';
}

function getPhone(item) {
  return item.phone || item.client_phone || '';
}

function getComment(item) {
  return item.comment || item.notes || '';
}

function getPaymentMethod(item) {
  return item.payment_method || '';
}

function getTrialDate(item) {
  return item.trial_date || item.scheduled_at;
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      {[
        ['kanban', 'Канбан'],
        ['table', 'Таблица'],
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

function TrialColumn({ children, column, count }) {
  const { isOver, setNodeRef } = useDroppable({ id: column.value });

  return (
    <section
      ref={setNodeRef}
      className={`flex max-h-[72vh] min-h-80 w-[310px] shrink-0 flex-col rounded-[22px] border bg-white p-4 shadow-card transition ${
        isOver ? 'border-brand/40 bg-brand/5 ring-4 ring-brand/10' : 'border-slate-100'
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">{column.label}</h3>
        <Badge value={count ? column.value : 'todo'}>{count}</Badge>
      </div>
      <div className="scrollbar-thin grid flex-1 content-start gap-3 overflow-y-auto pr-1">
        {count ? children : <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-400">Нет пробников</div>}
      </div>
    </section>
  );
}

function TrialCard({ canEdit, item, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(item.id),
    data: { item },
    disabled: !canEdit,
  });
  const comment = getComment(item);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-[20px] border border-slate-100 bg-white p-4 shadow-sm transition ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'z-20 opacity-60 ring-2 ring-brand/30' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{getStudentName(item)}</p>
          {getParentName(item) && <p className="mt-1 text-xs font-medium text-slate-500">Родитель: {getParentName(item)}</p>}
        </div>
        <Badge value={item.stage ?? item.status}>{stageLabel(item.stage ?? item.status)}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Телефон</dt><dd className="text-right font-medium">{dash(getPhone(item))}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Клиент</dt><dd className="text-right font-medium">{dash(item.client_name)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Менеджер</dt><dd className="text-right font-medium">{dash(item.manager_name)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата пробного</dt><dd className="text-right font-medium">{dateTime(getTrialDate(item))}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата оплаты</dt><dd className="text-right font-medium">{dash(item.payment_date)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Сумма</dt><dd className="text-right font-semibold text-brand">{money(item.price)}</dd></div>
        {getPaymentMethod(item) && <div className="flex justify-between gap-3"><dt className="text-slate-400">Оплата</dt><dd className="text-right font-medium">{getPaymentMethod(item)}</dd></div>}
      </dl>
      {item.subscription && <div className="mt-3"><Badge value="active">Абонемент создан</Badge></div>}
      {comment && <p className="mt-3 line-clamp-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{comment}</p>}
      {canEdit && <Button variant="secondary" className="mt-3 w-full" onClick={onEdit}>Редактировать</Button>}
    </article>
  );
}

function TrialsKanban({ canEdit, items, moveTrial, onEdit }) {
  const grouped = useMemo(() => {
    const result = Object.fromEntries(trialStages.map((stage) => [stage.value, []]));
    items.forEach((item) => {
      result[trialColumnId(item)]?.push(item);
    });
    return result;
  }, [items]);

  return (
    <DndContext
      onDragEnd={({ active, over }) => {
        if (!over) return;
        const item = active.data.current?.item;
        if (!item) return;
        moveTrial(item, over.id);
      }}
    >
      <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex min-w-max gap-4">
          {trialStages.map((stage) => {
            const columnItems = grouped[stage.value] || [];
            return (
              <TrialColumn key={stage.value} column={stage} count={columnItems.length}>
                {columnItems.map((item) => <TrialCard key={item.id} item={item} canEdit={canEdit} onEdit={() => onEdit(item)} />)}
              </TrialColumn>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

export default function TrialsPage() {
  const crud = useCrudResource('trials/', { search: '', stage: '', manager: '', scheduled_at_from: '', scheduled_at_to: '', payment_date_from: '', payment_date_to: '', branch: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentMethodOptions } = usePaymentMethods({ activeOnly: true });
  const { items: services } = useLookup('catalog-items/', { category: 'service', is_active: 'true' });
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const [viewMode, setViewMode] = useState('kanban');
  const [convertTrial, setConvertTrial] = useState(null);
  const [convertForm, setConvertForm] = useState(emptyConvertForm);
  const [addonCatalogItems, setAddonCatalogItems] = useState([]);
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState('');
  const { getDiscountById } = useDiscounts({ branch: convertTrial?.branch || '' });
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const fields = [
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Выберите клиента' },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из клиента' }, ...branchOptions] },
    { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
    { name: 'teacher', label: 'Преподаватель', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
    { name: 'payment_method', label: 'Способ оплаты', type: 'select', options: [{ value: '', label: 'Выберите способ' }, ...paymentMethodOptions] },
    ...baseFields,
  ];
  const total = crud.items.length;
  const bought = crud.items.filter((item) => trialColumnId(item) === 'bought' || item.bought_subscription).length;
  const lost = crud.items.filter((item) => trialColumnId(item) === 'lost').length;
  const paidTotal = crud.items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const conversion = total ? Math.round((bought / total) * 100) : 0;
  const convertSubtotal = Number(convertForm.price || 0) + addonsTotal(convertForm.addons, addonCatalogItems);
  const convertDiscount = getDiscountById(convertForm.discount);
  const convertDiscountAmount = calculateDiscountAmount(convertSubtotal, convertDiscount);
  const convertTotal = calculateDiscountedTotal(convertSubtotal, convertDiscount);

  const editTrial = (row) => {
    const { status, ...editableRow } = row;
    crud.setEditing({ ...editableRow, stage: row.stage ?? status });
    crud.setModalOpen(true);
  };

  const openConvertModal = (trial) => {
    setMessage('');
    setConvertTrial(trial);
    setConvertForm({
      ...emptyConvertForm,
      price: Number(trial.price || 0),
      payment_amount: Number(trial.price || 0),
      start_date: todayIso(),
      payment_date: todayIso(),
    });
    setPaymentTouched(false);
  };

  const moveTrial = async (item, nextStage) => {
    if (!canEdit) return;
    if (trialColumnId(item) === nextStage) return;
    if (isBoughtStage(nextStage)) {
      openConvertModal(item);
      return;
    }
    const previousItems = crud.items;
    crud.setItems((items) => items.map((trial) => (trial.id === item.id ? { ...trial, stage: nextStage, status: nextStage } : trial)));
    try {
      const { data } = await api.patch(`trials/${item.id}/`, { stage: nextStage });
      crud.setItems((items) => items.map((trial) => (trial.id === item.id ? { ...trial, ...data, stage: data.stage ?? data.status ?? nextStage } : trial)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  const saveTrial = async () => {
    const nextStage = form.stage ?? form.status;
    if (form.id && isBoughtStage(nextStage) && !form.subscription) {
      crud.setModalOpen(false);
      openConvertModal(form);
      return;
    }
    await crud.save(form);
  };

  const updateConvertForm = (patch) => setConvertForm((current) => ({ ...current, ...patch }));

  const setSubscriptionService = (value) => {
    const service = services.find((item) => String(item.id) === String(value));
    const startDate = convertForm.start_date || todayIso();
    const basePrice = Number(service?.price || 0);
    const nextSubtotal = basePrice + addonsTotal(convertForm.addons, addonCatalogItems);
    updateConvertForm({
      service: value,
      subscription_type: service?.name || '',
      total_visits: service?.lessons_count || 0,
      price: basePrice,
      payment_amount: paymentTouched ? convertForm.payment_amount : calculateDiscountedTotal(nextSubtotal, getDiscountById(convertForm.discount)),
      start_date: startDate,
      end_date: calculateEndDateFromService(startDate, service),
    });
  };

  const setConvertAddons = (value) => {
    const nextSubtotal = Number(convertForm.price || 0) + addonsTotal(value, addonCatalogItems);
    updateConvertForm({
      addons: value,
      payment_amount: paymentTouched ? convertForm.payment_amount : calculateDiscountedTotal(nextSubtotal, getDiscountById(convertForm.discount)),
    });
  };

  const setConvertDiscount = (value) => {
    updateConvertForm({
      discount: value,
      payment_amount: paymentTouched ? convertForm.payment_amount : calculateDiscountedTotal(convertSubtotal, getDiscountById(value)),
    });
  };

  const setConvertStartDate = (value) => {
    const service = services.find((item) => String(item.id) === String(convertForm.service));
    updateConvertForm({
      start_date: value,
      end_date: calculateEndDateFromService(value, service) || convertForm.end_date,
    });
  };

  const convertToSubscription = async () => {
    if (!convertTrial) return;
    setConverting(true);
    try {
      const { data } = await api.post(`trials/${convertTrial.id}/convert-to-subscription/`, { ...convertForm, addons: addonPayload(convertForm.addons) });
      crud.setItems((items) => items.map((trial) => (trial.id === convertTrial.id ? { ...trial, ...data.trial, stage: data.trial.stage ?? data.trial.status } : trial)));
      setConvertTrial(null);
      setMessage('Абонемент создан, клиент добавлен в раздел Абонементы.');
      await crud.reload();
    } catch (error) {
      showApiError(error);
    } finally {
      setConverting(false);
    }
  };

  return (
    <>
      <PageHeader title="Пробники" actionLabel="Добавить пробник" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Всего: {total}</span>
        <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Купили: {bought}</span>
        <span className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Не купили: {lost}</span>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Сумма: {money(paidTotal)}</span>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Конверсия: {conversion}%</span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </PageHeader>
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, ...trialStages]} />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <Input label="Пробный от" type="date" value={crud.filters.scheduled_at_from} onChange={(e) => crud.setFilters({ ...crud.filters, scheduled_at_from: e.target.value })} />
        <Input label="Пробный до" type="date" value={crud.filters.scheduled_at_to} onChange={(e) => crud.setFilters({ ...crud.filters, scheduled_at_to: e.target.value })} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      {message && <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {viewMode === 'kanban' ? (
        <TrialsKanban items={crud.items} canEdit={canEdit} moveTrial={moveTrial} onEdit={editTrial} />
      ) : (
        <Table data={crud.items} columns={[
          { key: 'student_name', header: 'ФИО', render: (row) => getStudentName(row) },
          { key: 'parent_name', header: 'Родитель', render: (row) => dash(getParentName(row)) },
          { key: 'phone', header: 'Телефон', render: (row) => dash(getPhone(row)) },
          { key: 'client', header: 'Клиент', render: (row) => dash(row.client_name) },
          { key: 'manager', header: 'Менеджер', render: (row) => dash(row.manager_name) },
          { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage ?? row.status}>{stageLabel(row.stage ?? row.status)}</Badge> },
          { key: 'subscription', header: 'Абонемент', render: (row) => row.subscription ? <Badge value="active">Создан</Badge> : '-' },
          { key: 'scheduled_at', header: 'Дата пробного', render: (row) => dateTime(getTrialDate(row)) },
          { key: 'payment_date', header: 'Дата оплаты', render: (row) => dash(row.payment_date) },
          { key: 'price', header: 'Сумма', render: (row) => money(row.price) },
          { key: 'notes', header: 'Комментарий', render: (row) => dash(getComment(row)) },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => editTrial(row)} onDelete={() => crud.remove(row.id)} /> },
        ]} />
      )}
      <CrudModal title="Пробник" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={saveTrial} />
      <Modal
        title="Создать абонемент"
        open={Boolean(convertTrial)}
        onClose={() => setConvertTrial(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConvertTrial(null)}>Отмена</Button>
            <Button onClick={convertToSubscription} disabled={converting}>{converting ? 'Создаем...' : 'Создать абонемент'}</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Клиент" value={convertTrial?.client_name || ''} onChange={() => {}} />
          <SelectField
            label="Услуга"
            value={convertForm.service}
            onChange={setSubscriptionService}
            options={[
              { value: '', label: services.length ? 'Выберите услугу' : 'Нет добавленных услуг' },
              ...services.map((service) => ({ value: String(service.id), label: `${service.name} · ${Number(service.price || 0).toLocaleString('ru-RU')} ₸` })),
            ]}
          />
          <SubscriptionAddonsSelect
            value={convertForm.addons}
            onCatalogItemsChange={setAddonCatalogItems}
            onChange={setConvertAddons}
          />
          <DiscountSelect value={convertForm.discount} onChange={setConvertDiscount} branch={convertTrial?.branch || ''} />
          <Input label="Дата начала" type="date" value={convertForm.start_date} onChange={(event) => setConvertStartDate(event.target.value)} />
          <Input label="Дата окончания" type="date" value={convertForm.end_date} onChange={(event) => updateConvertForm({ end_date: event.target.value })} />
          <Input label="Количество занятий" type="number" value={convertForm.total_visits} onChange={(event) => updateConvertForm({ total_visits: Number(event.target.value) })} />
          <Input label="Цена" type="number" value={convertForm.price} onChange={(event) => updateConvertForm({ price: Number(event.target.value) })} />
          <Input label="Сумма оплаты" type="number" value={convertForm.payment_amount} onChange={(event) => { setPaymentTouched(true); updateConvertForm({ payment_amount: Number(event.target.value) }); }} />
          <Input label="Дата оплаты" type="date" value={convertForm.payment_date} onChange={(event) => updateConvertForm({ payment_date: event.target.value })} />
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-700 md:col-span-2">
            <p>Основная услуга: {money(convertForm.price)}</p>
            <p>Дополнительные услуги: {money(addonsTotal(convertForm.addons, addonCatalogItems))}</p>
            <p>Промежуточный итог: {money(convertSubtotal)}</p>
            <p className="text-emerald-700">Скидка: −{money(convertDiscountAmount)}</p>
            <p className="mt-1 text-base text-slate-900">Итого: {money(convertTotal)}</p>
          </div>
          <SelectField
            label="Способ оплаты"
            value={convertForm.payment_method}
            onChange={(value) => updateConvertForm({ payment_method: value })}
            options={[{ value: '', label: 'Выберите способ' }, ...paymentMethodOptions]}
          />
          <Input label="Менеджер" value={convertTrial?.manager_name || ''} onChange={() => {}} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
            Комментарий
            <textarea
              className="min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={convertForm.comment}
              onChange={(event) => updateConvertForm({ comment: event.target.value })}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
