import { CheckCircle2 } from 'lucide-react';

import api from '../api/axios.js';
import KanbanBoard from '../components/ui/KanbanBoard.jsx';
import KanbanCard from '../components/ui/KanbanCard.jsx';
import { canCreateTasks, canDeleteTask, getStoredUser, hasRole, ROLES } from '../auth.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, showApiError, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useEmployeeOptions } from './lookupUtils.jsx';

const statuses = [
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'today', label: 'Сегодня' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'done', label: 'Выполнено' },
];
const empty = { title: '', description: '', assigned_to: '', client: '', due_at: '', status: 'new' };
const baseFields = [
  { name: 'title', label: 'Название' },
  { name: 'due_at', label: 'Срок', type: 'datetime-local' },
  { name: 'status', label: 'Статус', type: 'select', options: statuses },
  { name: 'description', label: 'Описание', type: 'textarea' },
];

const statusLabel = (value) => statuses.find((status) => status.value === value)?.label || (value === 'todo' ? 'Новые' : value || '—');
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : 'Без срока');
const dash = (value) => value || '—';

function taskColumnId(task) {
  return task.status === 'todo' ? 'new' : task.status;
}

function TaskCard({ canEdit, dragProps, markDone, onDelete, onEdit, task, user }) {
  return (
    <KanbanCard draggable={canEdit} {...dragProps}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{task.title}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">Клиент: {dash(task.client_name || task.client)}</p>
        </div>
        <Actions canEdit={canEdit} canDelete={canDeleteTask(task, user)} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Ответственный</dt><dd className="text-right font-medium">{dash(task.assigned_to_name || task.assigned_to)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Срок</dt><dd className="text-right font-medium">{dateTime(task.due_at)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Приоритет</dt><dd className="text-right font-medium">{dash(task.priority)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Статус</dt><dd><Badge value={taskColumnId(task)}>{statusLabel(task.status)}</Badge></dd></div>
      </dl>
      {task.description && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">{task.description}</p>}
      {task.status !== 'done' && (
        <Button variant="accent" className="mt-3 w-full" onClick={() => markDone(task)}>
          <CheckCircle2 size={16} />
          Выполнено
        </Button>
      )}
    </KanbanCard>
  );
}

export default function TasksPage() {
  const crud = useCrudResource('tasks/', { status: '', assigned_to: '', due_date: '' });
  const { clientOptions } = useClientOptions();
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher']);
  const user = getStoredUser();
  const canCreate = canCreateTasks(user);
  const canEdit = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.TEACHER]);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const fields = [
    baseFields[0],
    { name: 'assigned_to', label: 'Ответственный', type: 'select', options: [{ value: '', label: 'Не выбран' }, ...employeeOptions] },
    { name: 'client', label: 'Клиент', type: 'select', options: [{ value: '', label: 'Без клиента' }, ...clientOptions] },
    ...baseFields.slice(1),
  ];

  const markDone = async (task) => {
    const previousItems = crud.items;
    crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, status: 'done' } : item)));
    try {
      const { data } = await api.patch(`tasks/${task.id}/mark-done/`);
      crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, ...data } : item)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  const moveTask = async (task, nextStatus) => {
    if (!canEdit) return;
    if (taskColumnId(task) === nextStatus) return;
    if (nextStatus === 'done') {
      await markDone(task);
      return;
    }

    const previousItems = crud.items;
    crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    try {
      const { data } = await api.patch(`tasks/${task.id}/`, { status: nextStatus });
      crud.setItems((items) => items.map((item) => (item.id === task.id ? { ...item, ...data } : item)));
    } catch (error) {
      crud.setItems(previousItems);
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader title="Задачи" actionLabel="Добавить задачу" onAction={canCreate ? () => { crud.setEditing(empty); crud.setModalOpen(true); } : undefined} />
      <Filters>
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, ...statuses]} />
        <SelectField label="Ответственный" value={crud.filters.assigned_to} onChange={(value) => crud.setFilters({ ...crud.filters, assigned_to: value })} options={[{ value: '', label: 'Все' }, ...employeeOptions]} />
        <Input label="Дата срока" type="date" value={crud.filters.due_date} onChange={(e) => crud.setFilters({ ...crud.filters, due_date: e.target.value })} />
      </Filters>
      <KanbanBoard
        columns={statuses.map((status) => ({ id: status.value, title: status.label }))}
        items={crud.items.filter((task) => statuses.some((status) => status.value === taskColumnId(task)))}
        getColumnId={taskColumnId}
        onMove={moveTask}
        renderCard={(task, dragProps) => (
          <TaskCard
            key={task.id}
            task={task}
            user={user}
            canEdit={canEdit}
            dragProps={dragProps}
            markDone={markDone}
            onEdit={() => { crud.setEditing(task); crud.setModalOpen(true); }}
            onDelete={() => crud.remove(task.id)}
          />
        )}
      />
      <CrudModal title="Задача" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
