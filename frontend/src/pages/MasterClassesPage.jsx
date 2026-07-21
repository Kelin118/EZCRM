import { useState } from 'react';

import api from '../api/axios.js';
import KanbanBoard from '../components/ui/KanbanBoard.jsx';
import KanbanCard from '../components/ui/KanbanCard.jsx';
import DiscountSelect from '../components/sales/DiscountSelect.jsx';
import { canDeleteDangerous, canManageSales, getStoredUser } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';
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
  stage: 'lead',
  payment_date: '',
  capacity: 0,
  price: 0,
  payment_amount: 0,
  discount: '',
  payment_method: '',
  participants: [],
};

const baseFields = [
  { name: 'title', label: 'Предмет' },
  { name: 'starts_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'stage', label: 'Этап', type: 'select', options: masterClassStages },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'capacity', label: 'Мест', type: 'number' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'payment_amount', label: 'Оплачено', type: 'number' },
  { name: 'description', label: 'Комментарий', type: 'textarea' },
];

const stageLabel = (value) => masterClassStages.find((stage) => stage.value === value)?.label || value || '—';
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
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

  return (
    <KanbanCard draggable={canEdit} {...dragProps}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{clientName}</p>
          {clientInfo && <p className="mt-1 text-xs font-medium text-slate-500">{clientInfo}</p>}
        </div>
        <Badge value={item.stage}>{stageLabel(item.stage)}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Менеджер</dt><dd className="text-right font-medium">{dash(item.manager_name || item.manager)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата МК</dt><dd className="text-right font-medium">{dateTime(item.starts_at)}</dd></div>
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
  const crud = useCrudResource('master-classes/', { search: '', stage: '', manager: '', payment_date_from: '', payment_date_to: '', branch: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentMethodOptions } = usePaymentMethods({ activeOnly: true });
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['admin', 'teacher']);
  const [viewMode, setViewMode] = useState('table');
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const { getDiscountById } = useDiscounts({ branch: form.branch });
  const selectedDiscount = getDiscountById(form.discount);
  const discountAmount = calculateDiscountAmount(form.price, selectedDiscount);
  const totalAfterDiscount = calculateDiscountedTotal(form.price, selectedDiscount);
  const changeDiscount = (value) => {
    const discount = getDiscountById(value);
    setForm({ ...form, discount: value, payment_amount: calculateDiscountedTotal(form.price, discount) });
  };
  const fields = [
    baseFields[0],
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Выберите клиента' },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Не распределено' }, ...branchOptions] },
    { name: 'discount', type: 'custom', className: '', render: () => <DiscountSelect value={form.discount} onChange={changeDiscount} branch={form.branch} /> },
    { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
    { name: 'teacher', label: 'Куратор', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
    ...baseFields.slice(1),
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
    { name: 'payment_method', label: 'Способ оплаты', type: 'select', options: [{ value: '', label: 'Выберите способ' }, ...paymentMethodOptions] },
  ];
  const total = crud.items.reduce((sum, item) => sum + Number(item.payment_amount || 0), 0);

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
      <PageHeader title="Мастер-классы" actionLabel="Добавить МК" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено: {money(total)}</span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </PageHeader>
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, ...masterClassStages]} />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={masterClassStages.map((stage) => ({ id: stage.value, title: stage.label }))}
          items={crud.items}
          getColumnId={masterClassColumnId}
          onMove={moveMasterClass}
          renderCard={(item, dragProps) => <MasterClassCard key={item.id} item={item} canEdit={canEdit} onEdit={() => { crud.setEditing(item); crud.setModalOpen(true); }} dragProps={dragProps} />}
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
          { key: 'starts_at', header: 'Дата', render: (row) => dateTime(row.starts_at) },
          { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage}>{stageLabel(row.stage)}</Badge> },
          { key: 'capacity', header: 'Мест' },
          { key: 'price', header: 'Цена', render: (row) => money(row.price) },
          { key: 'payment_amount', header: 'Оплачено', render: (row) => money(row.payment_amount) },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
        ]} />
      )}
      <CrudModal title="Мастер-класс" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
