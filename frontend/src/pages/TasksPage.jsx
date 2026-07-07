import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import api from '../api/axios.js';
import { canCreateTasks, canDeleteTask, getStoredUser, hasRole, ROLES } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions } from './lookupUtils.jsx';

const NEW_STATUS = 'new';
const IN_PROGRESS_STATUS = 'in_progress';
const DONE_STATUS = 'done';

const statusOptions = [
  { value: NEW_STATUS, label: 'Новые' },
  { value: IN_PROGRESS_STATUS, label: 'В работе' },
  { value: DONE_STATUS, label: 'Выполнено' },
  { value: 'cancelled', label: 'Отменено' },
];

const kanbanColumns = [
  { id: 'new', title: 'Новые' },
  { id: 'in_progress', title: 'В работе' },
  { id: 'today', title: 'Сегодня' },
  { id: 'overdue', title: 'Просрочено', hint: 'Просроченные задачи появляются здесь автоматически по сроку' },
  { id: 'done', title: 'Выполнено' },
];

const empty = { title: '', description: '', assigned_to: '', client: '', due_at: '', status: NEW_STATUS };
const baseFields = [
  { name: 'title', label: 'Название' },
  { name: 'due_at', label: 'Срок', type: 'datetime-local' },
  { name: 'status', label: 'Статус', type: 'select', options: statusOptions },
  { name: 'description', label: 'Описание', type: 'textarea' },
];

const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : 'Без срока');
const dash = (value) => value || '—';
const isDone = (task) => ['done', 'completed'].includes(task.status);
const isNew = (task) => ['new', 'pending', 'todo'].includes(task.status);

function localDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA');
}

function todayDate() {
  return new Date().toLocaleDateString('en-CA');
}

function dateTimeAtStart(dateValue) {
  return `${dateValue}T09:00`;
}

function taskColumnId(task) {
  if (isDone(task)) return 'done';
  const dueDate = localDate(task.due_at);
  const today = todayDate();
  if (dueDate && dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (task.status === IN_PROGRESS_STATUS) return 'in_progress';
  if (isNew(task)) return 'new';
  return 'new';
}

function statusLabel(value) {
  if (['todo', 'pending'].includes(value)) return 'Новые';
  if (value === 'completed') return 'Выполнено';
  return statusOptions.find((status) => status.value === value)?.label || value || '—';
}

function showMessage(message) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
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

function TaskColumn({ children, column, count }) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={`flex max-h-[72vh] min-h-80 w-[300px] shrink-0 flex-col rounded-[22px] border bg-white p-4 shadow-card transition ${
        isOver && column.id !== 'overdue' ? 'border-brand/40 bg-brand/5 ring-4 ring-brand/10' : 'border-slate-100'
      } ${column.id === 'overdue' ? 'border-red-100 bg-red-50/40' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">{column.title}</h3>
        <Badge value={count ? (column.id === 'overdue' ? 'overdue' : 'active') : 'todo'}>{count}</Badge>
      </div>
      {column.hint && <p className="mb-3 rounded-2xl bg-white/80 px-3 py-2 text-xs font-medium text-slate-500">{column.hint}</p>}
      <div className="scrollbar-thin grid flex-1 content-start gap-3 overflow-y-auto pr-1">
        {count ? children : <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-400">Нет задач</div>}
      </div>
    </section>
  );
}

function TaskCard({ canEdit, markDone, onDelete, onEdit, task, user }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(task.id),
    data: { task },
    disabled: !canEdit,
  });

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
          <p className="font-semibold text-slate-900">{task.title}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">Клиент: {dash(task.client_name)}</p>
        </div>
        <Actions canEdit={canEdit} canDelete={canDeleteTask(task, user)} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Ответственный</dt><dd className="text-right font-medium">{dash(task.assigned_to_name)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Срок</dt><dd className="text-right font-medium">{dateTime(task.due_at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Приоритет</dt><dd className="text-right font-medium">{dash(task.priority)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Статус</dt><dd><Badge value={isDone(task) ? 'done' : task.status}>{statusLabel(task.status)}</Badge></dd></div>
      </dl>
      {task.description && <p className="mt-3 line-clamp-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{task.description}</p>}
      {!isDone(task) && (
        <Button variant="accent" className="mt-3 w-full" onClick={() => markDone(task)}>
          <CheckCircle2 size={16} />
          Выполнено
        </Button>
      )}
    </article>
  );
}

function TaskKanban({ canEdit, items, markDone, moveTask, onDelete, onEdit, user }) {
  const grouped = useMemo(() => {
    const result = Object.fromEntries(kanbanColumns.map((column) => [column.id, []]));
    items.forEach((task) => {
      result[taskColumnId(task)]?.push(task);
    });
    return result;
  }, [items]);

  return (
    <DndContext
      onDragEnd={({ active, over }) => {
        if (!over) return;
        const task = active.data.current?.task;
        if (!task) return;
        moveTask(task, over.id);
      }}
    >
      <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex min-w-max gap-4">
          {kanbanColumns.map((column) => {
            const columnItems = grouped[column.id] || [];
            return (
              <TaskColumn key={column.id} column={column} count={columnItems.length}>
                {columnItems.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    user={user}
                    canEdit={canEdit}
                    markDone={markDone}
                    onEdit={() => onEdit(task)}
                    onDelete={() => onDelete(task.id)}
                  />
                ))}
              </TaskColumn>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

export default function TasksPage() {
  const crud = useCrudResource('tasks/', { search: '', status: '', assigned_to: '', due_date_from: '', due_date_to: '' });
  const { clientOptions } = useClientOptions();
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher']);
  const [viewMode, setViewMode] = useState('kanban');
  const user = getStoredUser();
  const canCreate = canCreateTasks(user);
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.TEACHER]);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const fields = [
    baseFields[0],
    { name: 'assigned_to', label: 'Ответственный', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...employeeOptions] },
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Без клиента' },
    ...baseFields.slice(1),
  ];

  const openEdit = (task) => {
    crud.setEditing(task);
    crud.setModalOpen(true);
  };

  const markDone = async (task) => {
    const previousItems = crud.items;
    crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, status: DONE_STATUS } : item)));
    try {
      const { data } = await api.patch(`tasks/${task.id}/mark-done/`);
      crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, ...data } : item)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  const patchTask = async (task, payload) => {
    const previousItems = crud.items;
    crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, ...payload } : item)));
    try {
      const { data } = await api.patch(`tasks/${task.id}/`, payload);
      crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, ...data } : item)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  const moveTask = async (task, columnId) => {
    if (!canEdit) return;
    if (columnId === 'overdue') {
      showMessage('Просроченные задачи появляются здесь автоматически по сроку');
      return;
    }
    if (taskColumnId(task) === columnId) return;
    if (columnId === 'done') {
      await markDone(task);
      return;
    }
    if (columnId === 'today') {
      await patchTask(task, { status: IN_PROGRESS_STATUS, due_at: dateTimeAtStart(todayDate()) });
      return;
    }
    if (columnId === 'new') {
      await patchTask(task, { status: NEW_STATUS });
      return;
    }
    if (columnId === 'in_progress') {
      await patchTask(task, { status: IN_PROGRESS_STATUS });
    }
  };

  return (
    <>
      <PageHeader title="Задачи" actionLabel="Добавить задачу" onAction={canCreate ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined}>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </PageHeader>
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, ...statusOptions]} />
        <SelectField label="Ответственный" value={crud.filters.assigned_to} onChange={(value) => crud.setFilters({ ...crud.filters, assigned_to: value })} options={[{ value: '', label: 'Все' }, ...employeeOptions]} />
        <Input label="Срок от" type="date" value={crud.filters.due_date_from} onChange={(e) => crud.setFilters({ ...crud.filters, due_date_from: e.target.value })} />
        <Input label="Срок до" type="date" value={crud.filters.due_date_to} onChange={(e) => crud.setFilters({ ...crud.filters, due_date_to: e.target.value })} />
      </Filters>
      {viewMode === 'kanban' ? (
        <TaskKanban
          items={crud.items}
          user={user}
          canEdit={canEdit}
          markDone={markDone}
          moveTask={moveTask}
          onEdit={openEdit}
          onDelete={(id) => crud.remove(id)}
        />
      ) : (
        <Table data={crud.items} columns={[
          { key: 'title', header: 'Название' },
          { key: 'client', header: 'Клиент', render: (row) => row.client_name || '—' },
          { key: 'assigned_to', header: 'Ответственный', render: (row) => row.assigned_to_name || '—' },
          { key: 'due_at', header: 'Срок', render: (row) => dateTime(row.due_at) },
          { key: 'priority', header: 'Приоритет', render: (row) => dash(row.priority) },
          { key: 'status', header: 'Статус', render: (row) => <Badge value={isDone(row) ? 'done' : row.status}>{statusLabel(row.status)}</Badge> },
          { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDeleteTask(row, user)} onEdit={() => openEdit(row)} onDelete={() => crud.remove(row.id)} /> },
        ]} />
      )}
      <CrudModal title="Задача" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
