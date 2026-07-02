import { CheckCircle2 } from 'lucide-react';

import api from '../api/axios.js';
import { Actions, Badge, Button, CrudModal, Filters, Input, PageHeader, SelectField, useCrudResource } from './pageUtils.jsx';

const statuses = [
  { value: 'todo', label: 'К выполнению' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Выполнено' },
  { value: 'cancelled', label: 'Отменено' },
];
const empty = { title: '', description: '', assigned_to: '', client: '', due_at: '', status: 'todo' };
const fields = [
  { name: 'title', label: 'Название' },
  { name: 'assigned_to', label: 'ID ответственного', type: 'number' },
  { name: 'client', label: 'ID клиента', type: 'number' },
  { name: 'due_at', label: 'Срок', type: 'datetime-local' },
  { name: 'status', label: 'Статус', type: 'select', options: statuses },
  { name: 'description', label: 'Описание', type: 'textarea' },
];

export default function TasksPage() {
  const crud = useCrudResource('tasks/', { status: '', assigned_to: '', due_date: '' });
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);

  const markDone = async (id) => {
    await api.patch(`tasks/${id}/mark-done/`);
    await crud.reload();
  };

  return (
    <>
      <PageHeader title="Задачи" actionLabel="Добавить задачу" onAction={() => { crud.setEditing(empty); crud.setModalOpen(true); }} />
      <Filters>
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, ...statuses]} />
        <Input label="ID ответственного" value={crud.filters.assigned_to} onChange={(e) => crud.setFilters({ ...crud.filters, assigned_to: e.target.value })} />
        <Input label="Дата срока" type="date" value={crud.filters.due_date} onChange={(e) => crud.setFilters({ ...crud.filters, due_date: e.target.value })} />
      </Filters>
      <div className="grid gap-4 xl:grid-cols-4">
        {statuses.map((status) => (
          <section key={status.value} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">{status.label}</h3>
              <Badge value={status.value}>{crud.items.filter((item) => item.status === status.value).length}</Badge>
            </div>
            <div className="grid gap-3">
              {crud.items.filter((item) => item.status === status.value).map((task) => (
                <article key={task.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{task.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{task.due_at ? new Date(task.due_at).toLocaleString('ru-RU') : 'Без срока'}</p>
                    </div>
                    <Actions onEdit={() => { crud.setEditing(task); crud.setModalOpen(true); }} onDelete={() => crud.remove(task.id)} />
                  </div>
                  {task.description && <p className="mt-2 text-sm text-slate-600">{task.description}</p>}
                  {task.status !== 'done' && (
                    <Button variant="accent" className="mt-3 w-full" onClick={() => markDone(task.id)}>
                      <CheckCircle2 size={16} />
                      Выполнено
                    </Button>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      <CrudModal title="Задача" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
