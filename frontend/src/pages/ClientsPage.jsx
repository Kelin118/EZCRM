import { AlertTriangle, GitMerge, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageClients, getStoredUser, isAdmin } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import { Actions, Badge, Filters, Input, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const emptyClient = {
  first_name: '',
  last_name: '',
  parent_name: '',
  phone: '',
  email: '',
  birth_date: '',
  school_class: '',
  direction: '',
  manager: '',
  notes: '',
  is_active: true,
  branch: '',
};

const usageLabels = {
  subscriptions_count: 'Абонементы',
  finance_count: 'Финансы',
  visits_count: 'Посещения',
  trials_count: 'Пробники',
  master_classes_count: 'МК',
  leads_count: 'Обращения',
  tasks_count: 'Задачи',
  addon_sales_count: 'Продажи',
  certificate_batches_count: 'Партии сертификатов',
  certificates_count: 'Сертификаты',
  group_memberships_count: 'Группы',
  chat_messages_count: 'Чат',
  messaging_contacts_count: 'Контакты',
};

function clientName(client) {
  return client.full_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || `Клиент #${client.id}`;
}

function usageTotal(usage = {}) {
  return Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
}

function UsageSummary({ usage }) {
  const entries = Object.entries(usage || {}).filter(([, value]) => Number(value || 0) > 0);
  if (!entries.length) return <span className="text-xs font-semibold text-emerald-700">Истории нет</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span key={key} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          {usageLabels[key] || key}: {value}
        </span>
      ))}
    </div>
  );
}

function DuplicateBadge({ row, onClick }) {
  if (!row.has_phone_duplicate) return null;
  return (
    <button
      type="button"
      title="Этот номер указан у нескольких клиентов."
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
    >
      <AlertTriangle size={13} aria-hidden="true" />
      Дубликат ×{row.duplicate_phone_count}
    </button>
  );
}

export default function ClientsPage() {
  const crud = useCrudResource('clients/', { search: '', status: '', manager: '', branch: '', duplicates: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['admin', 'manager']);
  const user = getStoredUser();
  const canEdit = canManageClients(user);
  const canDelete = canDeleteDangerous(user);
  const canMerge = isAdmin(user);
  const form = crud.editing || emptyClient;
  const [phoneWarning, setPhoneWarning] = useState(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState({ open: false, source: null, clients: [], loading: false });
  const [mergeTarget, setMergeTarget] = useState(null);
  const [merging, setMerging] = useState(false);

  const openCreate = () => {
    setPhoneWarning(null);
    crud.setEditing(emptyClient);
    crud.setModalOpen(true);
  };

  const openEdit = (client) => {
    setPhoneWarning(null);
    crud.setEditing(client);
    crud.setModalOpen(true);
  };

  const setFormField = (field, value) => crud.setEditing((current) => ({ ...(current || emptyClient), [field]: value }));

  useEffect(() => {
    if (!crud.modalOpen) return undefined;
    const phone = String(form.phone || '').trim();
    if (!phone) {
      setPhoneWarning(null);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setCheckingPhone(true);
      try {
        const { data } = await api.get('clients/phone-duplicates/', { params: { phone, exclude_client: form.id || '' } });
        setPhoneWarning(data.has_duplicates ? data : null);
      } catch (error) {
        showApiError(error);
      } finally {
        setCheckingPhone(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [crud.modalOpen, form.phone, form.id]);

  const saveClient = async () => {
    await crud.save(form);
    setPhoneWarning(null);
  };

  const loadDuplicates = async (row) => {
    setDuplicateModal({ open: true, source: row, clients: [], loading: true });
    try {
      const { data } = await api.get('clients/phone-duplicates/', { params: { phone: row.phone } });
      setDuplicateModal({ open: true, source: row, clients: data.results || [], loading: false });
    } catch (error) {
      setDuplicateModal({ open: true, source: row, clients: [], loading: false });
      showApiError(error);
    }
  };

  const deleteEmptyDuplicate = async (client) => {
    if (!window.confirm('Удалить пустой дубль?')) return;
    try {
      await api.delete(`clients/${client.id}/`);
      await crud.reload();
      if (duplicateModal.source) await loadDuplicates(duplicateModal.source);
    } catch (error) {
      showApiError(error);
    }
  };

  const confirmMerge = async () => {
    if (!mergeTarget) return;
    setMerging(true);
    try {
      await api.post('clients/merge/', {
        primary_client: mergeTarget.primary.id,
        duplicate_client: mergeTarget.duplicate.id,
      });
      setMergeTarget(null);
      setDuplicateModal({ open: false, source: null, clients: [], loading: false });
      await crud.reload();
    } catch (error) {
      showApiError(error);
    } finally {
      setMerging(false);
    }
  };

  const clientFields = (
    <div className="grid gap-4 md:grid-cols-2">
      <Input label="Имя *" value={form.first_name || ''} onChange={(e) => setFormField('first_name', e.target.value)} />
      <Input label="Фамилия" value={form.last_name || ''} onChange={(e) => setFormField('last_name', e.target.value)} />
      <Input label="Родитель" value={form.parent_name || ''} onChange={(e) => setFormField('parent_name', e.target.value)} />
      <div>
        <Input label="Телефон" value={form.phone || ''} onChange={(e) => setFormField('phone', e.target.value)} />
        {checkingPhone && <p className="mt-1 text-xs font-semibold text-slate-500">Проверяем номер…</p>}
        {phoneWarning && (
          <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">Такой номер уже используется у {phoneWarning.count} клиентов.</p>
            <Button className="mt-2 h-9 px-3" variant="secondary" onClick={() => setDuplicateModal({ open: true, source: form, clients: phoneWarning.results || [], loading: false })}>
              Посмотреть
            </Button>
          </div>
        )}
      </div>
      <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setFormField('email', e.target.value)} />
      <Input label="Дата рождения" type="date" value={form.birth_date || ''} onChange={(e) => setFormField('birth_date', e.target.value)} />
      <Input label="Класс" value={form.school_class || ''} onChange={(e) => setFormField('school_class', e.target.value)} />
      <Input label="Направление" value={form.direction || ''} onChange={(e) => setFormField('direction', e.target.value)} />
      <SelectField label="Филиал *" value={form.branch || ''} onChange={(value) => setFormField('branch', value)} options={[{ value: '', label: 'Не распределено' }, ...branchOptions]} />
      <SelectField label="Менеджер *" value={form.manager || ''} onChange={(value) => setFormField('manager', value)} options={[{ value: '', label: 'Не выбран' }, ...managerOptions]} />
      <SelectField label="Статус" value={form.is_active ?? true} onChange={(value) => setFormField('is_active', value === 'true' || value === true)} options={[{ value: true, label: 'Активен' }, { value: false, label: 'Неактивен' }]} />
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
        Комментарий
        <textarea
          className="min-h-28 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition-[border-color,box-shadow,background-color,color] duration-150 hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
          value={form.notes || ''}
          onChange={(e) => setFormField('notes', e.target.value)}
        />
      </label>
    </div>
  );

  return (
    <>
      <PageHeader title="Клиенты" actionLabel="Добавить клиента" onAction={canEdit ? openCreate : undefined} />
      <Filters>
        <Input label="Поиск" value={crud.filters.search} onChange={(e) => crud.setFilters({ ...crud.filters, search: e.target.value })} />
        <SelectField
          label="Статус"
          value={crud.filters.status}
          onChange={(value) => crud.setFilters({ ...crud.filters, status: value })}
          options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Неактивные' }]}
        />
        <SelectField label="Менеджер" value={crud.filters.manager} onChange={(value) => crud.setFilters({ ...crud.filters, manager: value })} options={[{ value: '', label: 'Все' }, ...managerOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <SelectField label="Дубликаты" value={crud.filters.duplicates || ''} onChange={(value) => crud.setFilters({ ...crud.filters, duplicates: value })} options={[{ value: '', label: 'Все' }, { value: 'true', label: 'Только дубликаты' }]} />
      </Filters>
      <Table
        data={crud.items}
        loading={crud.loading}
        columns={[
          {
            key: 'name',
            header: 'Клиент',
            render: (row) => (
              <Link className="font-medium text-brand hover:underline" to={`/clients/${row.id}`}>
                {clientName(row)}
              </Link>
            ),
          },
          { key: 'parent_name', header: 'Родитель' },
          {
            key: 'phone',
            header: 'Телефон',
            render: (row) => (
              <div className={`inline-flex items-center gap-2 rounded-xl px-2 py-1 ${row.has_phone_duplicate ? 'bg-red-50' : ''}`}>
                <span>{row.phone || '—'}</span>
                <DuplicateBadge row={row} onClick={() => loadDuplicates(row)} />
              </div>
            ),
          },
          { key: 'school_class', header: 'Класс' },
          { key: 'direction', header: 'Направление' },
          { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
          { key: 'is_active', header: 'Статус', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Активен' : 'Неактивен'}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex gap-2">
                <Link to={`/clients/${row.id}`}>
                  <Button variant="secondary">Открыть</Button>
                </Link>
                <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => openEdit(row)} onDelete={() => crud.remove(row.id)} />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title="Клиент"
        open={crud.modalOpen}
        onClose={() => crud.setModalOpen(false)}
        footer={<><Button variant="secondary" onClick={() => crud.setModalOpen(false)}>Отмена</Button><Button onClick={saveClient} disabled={crud.saving}>Сохранить</Button></>}
      >
        {clientFields}
      </Modal>

      <Modal title="Дубликаты номера" open={duplicateModal.open} onClose={() => setDuplicateModal({ open: false, source: null, clients: [], loading: false })} size="wide">
        {duplicateModal.loading ? (
          <p className="text-sm font-semibold text-slate-500">Загрузка…</p>
        ) : (
          <div className="grid gap-3">
            {duplicateModal.clients.map((client) => (
              <div key={client.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{client.full_name}</p>
                    <p className="mt-1 text-sm text-slate-600">{[client.phone || 'Телефон не указан', client.branch_name || 'Не распределено', client.manager_name || 'Менеджер не выбран', client.is_active ? 'Активен' : 'Неактивен'].join(' · ')}</p>
                    <div className="mt-3"><UsageSummary usage={client.usage} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/clients/${client.id}`}><Button variant="secondary">Открыть карточку</Button></Link>
                    {canMerge && duplicateModal.source?.id && client.id !== duplicateModal.source.id && (
                      <Button variant="accent" onClick={() => setMergeTarget({ primary: duplicateModal.source, duplicate: client })}>
                        <GitMerge size={16} />
                        Объединить клиентов
                      </Button>
                    )}
                    {canDelete && usageTotal(client.usage) === 0 && (
                      <Button variant="danger" onClick={() => deleteEmptyDuplicate(client)}>
                        <Trash2 size={16} />
                        Удалить пустой дубль
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!duplicateModal.clients.length && <p className="text-sm font-semibold text-slate-500">Совпадений не найдено.</p>}
          </div>
        )}
      </Modal>

      <Modal
        title="Подтвердите объединение"
        open={Boolean(mergeTarget)}
        onClose={() => setMergeTarget(null)}
        footer={<><Button variant="secondary" onClick={() => setMergeTarget(null)}>Отмена</Button><Button variant="danger" onClick={confirmMerge} disabled={merging}>Объединить клиентов</Button></>}
      >
        {mergeTarget && (
          <div className="grid gap-4 text-sm">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-bold uppercase text-emerald-700">Основной клиент</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{clientName(mergeTarget.primary)}</p>
              <UsageSummary usage={mergeTarget.primary.usage} />
            </div>
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
              <p className="text-xs font-bold uppercase text-red-700">Будет объединён</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{clientName(mergeTarget.duplicate)}</p>
              <UsageSummary usage={mergeTarget.duplicate.usage} />
            </div>
            <p className="font-semibold text-slate-600">История второго клиента будет перенесена к основному, после чего дубль будет удалён.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
