import { useState } from 'react';

import api from '../api/axios.js';
import KanbanBoard from '../components/ui/KanbanBoard.jsx';
import KanbanCard from '../components/ui/KanbanCard.jsx';
import { canDeleteDangerous, canManageSales, getStoredUser } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, money, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions } from './lookupUtils.jsx';

const trialStages = [
  { value: 'lead', label: 'Лид' },
  { value: 'booked', label: 'Записался на пробный' },
  { value: 'attended', label: 'Прошел пробный' },
  { value: 'bought', label: 'Купил абонемент' },
  { value: 'lost', label: 'Не купил' },
];

const empty = { client: '', manager: '', teacher: '', scheduled_at: '', stage: 'lead', payment_date: '', price: 0, bought_subscription: false, notes: '' };
const baseFields = [
  { name: 'scheduled_at', label: 'Дата и время', type: 'datetime-local' },
  { name: 'payment_date', label: 'Дата оплаты', type: 'date' },
  { name: 'price', label: 'Цена', type: 'number' },
  { name: 'stage', label: 'Этап', type: 'select', options: trialStages },
  { name: 'bought_subscription', label: 'Купил абонемент', type: 'select', options: [{ value: false, label: 'Нет' }, { value: true, label: 'Да' }] },
  { name: 'notes', label: 'Заметки', type: 'textarea' },
];

const stageLabel = (value) => trialStages.find((stage) => stage.value === value)?.label || value || '—';
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
const dash = (value) => value || '—';
const trialColumnId = (item) => {
  const stage = item.stage ?? item.status;
  if (stage === 'new') return 'lead';
  if (stage === 'scheduled') return 'booked';
  if (stage === 'completed') return 'attended';
  if (stage === 'cancelled') return 'lost';
  return stage;
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

function TrialCard({ canEdit, item, onEdit, dragProps }) {
  return (
    <KanbanCard draggable={canEdit} {...dragProps}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{item.client_name || `Клиент #${item.client}`}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">Родитель: {dash(item.client_parent_name)}</p>
        </div>
        <Badge value={item.stage ?? item.status}>{stageLabel(item.stage ?? item.status)}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Телефон</dt><dd className="text-right font-medium">{dash(item.client_phone)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Менеджер</dt><dd className="text-right font-medium">{dash(item.manager_name || item.manager)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата пробного</dt><dd className="text-right font-medium">{dateTime(item.scheduled_at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Дата оплаты</dt><dd className="text-right font-medium">{dash(item.payment_date)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Сумма</dt><dd className="text-right font-semibold text-brand">{money(item.price)}</dd></div>
      </dl>
      {item.notes && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{item.notes}</p>}
      {canEdit && <Button variant="secondary" className="mt-3 w-full" onClick={onEdit}>Редактировать</Button>}
    </KanbanCard>
  );
}

export default function TrialsPage() {
  const crud = useCrudResource('trials/', { stage: '', manager: '', payment_date_from: '', payment_date_to: '' });
  const { clientOptions } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['admin', 'teacher']);
  const [viewMode, setViewMode] = useState('table');
  const user = getStoredUser();
  const canEdit = canManageSales(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const fields = [
    { name: 'client', label: 'Клиент', type: 'select', options: [{ value: '', label: 'Выберите клиента' }, ...clientOptions] },
    { name: 'manager', label: 'Менеджер', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...managerOptions] },
    { name: 'teacher', label: 'Преподаватель', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...teacherOptions] },
    ...baseFields,
  ];
  const total = crud.items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const editTrial = (row) => {
    const { status, ...editableRow } = row;
    crud.setEditing({ ...editableRow, stage: row.stage ?? status });
    crud.setModalOpen(true);
  };

  const moveTrial = async (item, nextStage) => {
    if (!canEdit) return;
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

  return (
    <>
      <PageHeader title="Пробники" actionLabel="Добавить пробник" onAction={canEdit ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Итого: {money(total)}</span>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Купили: {crud.items.filter((item) => item.bought_subscription).length}</span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </PageHeader>
      <Filters>
        <SelectField label="Этап" value={crud.filters.stage} onChange={(value) => crud.setFilters({ ...crud.filters, stage: value })} options={[{ value: '', label: 'Все' }, ...trialStages]} />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <Input label="Оплата от" type="date" value={crud.filters.payment_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_from: e.target.value })} />
        <Input label="Оплата до" type="date" value={crud.filters.payment_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, payment_date_to: e.target.value })} />
      </Filters>
      {viewMode === 'kanban' ? (
        <KanbanBoard
          columns={trialStages.map((stage) => ({ id: stage.value, title: stage.label }))}
          items={crud.items}
          getColumnId={trialColumnId}
          onMove={moveTrial}
          renderCard={(item, dragProps) => <TrialCard key={item.id} item={item} canEdit={canEdit} onEdit={() => editTrial(item)} dragProps={dragProps} />}
        />
      ) : (
        <Table data={crud.items} columns={[
          { key: 'client', header: 'Клиент', render: (row) => row.client_name || `#${row.client}` },
          { key: 'scheduled_at', header: 'Дата', render: (row) => dateTime(row.scheduled_at) },
          { key: 'stage', header: 'Этап', render: (row) => <Badge value={row.stage ?? row.status}>{stageLabel(row.stage ?? row.status)}</Badge> },
          { key: 'payment_date', header: 'Оплата' },
          { key: 'price', header: 'Сумма', render: (row) => money(row.price) },
          { key: 'bought_subscription', header: 'Купил', render: (row) => (row.bought_subscription ? 'Да' : 'Нет') },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => editTrial(row)} onDelete={() => crud.remove(row.id)} /> },
        ]} />
      )}
      <CrudModal title="Пробник" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
