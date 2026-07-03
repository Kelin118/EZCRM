import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageVisits, getStoredUser } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import { Actions, Badge, Filters, Input, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { subscriptionLabel, useClientOptions, useEmployeeOptions, useLookup } from './lookupUtils.jsx';

const empty = {
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

const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');
const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
const statusLabel = (value) => visitStatusOptions.find((item) => item.value === value)?.label || value || '—';

export default function VisitsPage() {
  const crud = useCrudResource('visits/', { client: '', date: '' });
  const { clientOptions } = useClientOptions();
  const { employeeOptions } = useEmployeeOptions(['teacher', 'admin']);
  const user = getStoredUser();
  const canEdit = canManageVisits(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const selectedClient = form.client || '';
  const { items: subscriptions, loading: loadingSubscriptions } = useLookup('subscriptions/', { client: selectedClient }, { enabled: Boolean(selectedClient) });
  const subscriptionOptions = useMemo(
    () => subscriptions.map((subscription) => ({ value: String(subscription.id), label: subscriptionLabel(subscription) })),
    [subscriptions],
  );

  useEffect(() => {
    if (!crud.editing) return;
    const selectedSubscriptionExists = subscriptionOptions.some((option) => option.value === String(crud.editing.subscription || ''));
    if (crud.editing.subscription && selectedClient && subscriptionOptions.length && !selectedSubscriptionExists) {
      crud.setEditing({ ...crud.editing, subscription: '' });
    }
  }, [subscriptionOptions, selectedClient]);

  const openCreate = () => {
    crud.setEditing(empty);
    crud.setModalOpen(true);
  };

  const openEdit = (row) => {
    crud.setEditing({
      ...row,
      client: row.client ? String(row.client) : '',
      subscription: row.subscription ? String(row.subscription) : '',
      teacher: row.teacher ? String(row.teacher) : '',
      visited_at: dateOnly(row.visited_at),
    });
    crud.setModalOpen(true);
  };

  const setForm = (patch) => crud.setEditing({ ...form, ...patch });

  const saveVisit = async () => {
    const payload = {
      ...form,
      client: form.client || null,
      subscription: form.subscription || null,
      teacher: form.teacher || null,
      visited_at: form.visited_at ? `${form.visited_at}T00:00` : null,
    };

    try {
      if (crud.editing?.id) {
        await api.patch(`visits/${crud.editing.id}/`, payload);
      } else {
        await api.post('visits/', payload);
      }
      crud.setModalOpen(false);
      crud.setEditing(null);
      await crud.reload();
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <>
      <PageHeader title="Посещения" actionLabel="Добавить посещение" onAction={canEdit ? openCreate : undefined} />
      <Filters>
        <SelectField label="Клиент" value={crud.filters.client} onChange={(value) => crud.setFilters({ ...crud.filters, client: value })} options={[{ value: '', label: 'Все' }, ...clientOptions]} />
        <Input label="Дата" type="date" value={crud.filters.date} onChange={(e) => crud.setFilters({ ...crud.filters, date: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'client', header: 'Клиент', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || `Клиент #${row.client}`}</Link> },
        { key: 'subscription', header: 'Абонемент', render: (row) => row.subscription_title || '—' },
        { key: 'teacher', header: 'Учитель', render: (row) => row.teacher_name || '—' },
        { key: 'visited_at', header: 'Дата', render: (row) => dateTime(row.visited_at) },
        { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{statusLabel(row.status)}</Badge> },
        { key: 'notes', header: 'Комментарий' },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => openEdit(row)} onDelete={() => crud.remove(row.id)} /> },
      ]} />

      <Modal
        title="Посещение"
        open={crud.modalOpen}
        onClose={() => crud.setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => crud.setModalOpen(false)}>Отмена</Button>
            <Button onClick={saveVisit} disabled={crud.saving}>Сохранить</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Клиент"
            value={form.client || ''}
            onChange={(value) => setForm({ client: value, subscription: '' })}
            options={[{ value: '', label: 'Выберите клиента' }, ...clientOptions]}
          />
          <SelectField
            label="Абонемент"
            value={form.subscription || ''}
            onChange={(value) => setForm({ subscription: value })}
            options={[
              { value: '', label: selectedClient ? (loadingSubscriptions ? 'Загрузка абонементов...' : (subscriptionOptions.length ? 'Без абонемента' : 'Нет активных абонементов')) : 'Сначала выберите клиента' },
              ...subscriptionOptions,
            ]}
          />
          <SelectField
            label="Учитель"
            value={form.teacher || ''}
            onChange={(value) => setForm({ teacher: value })}
            options={[{ value: '', label: 'Не выбран' }, ...employeeOptions]}
          />
          <Input label="Дата занятия" type="date" value={form.visited_at || ''} onChange={(event) => setForm({ visited_at: event.target.value })} />
          <SelectField label="Статус" value={form.status || 'attended'} onChange={(value) => setForm({ status: value })} options={visitStatusOptions} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
            Комментарий
            <textarea
              className="min-h-28 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={form.notes || ''}
              onChange={(event) => setForm({ notes: event.target.value })}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
