import { Link } from 'react-router-dom';

import { canDeleteDangerous, canManageSubscriptions, getStoredUser } from '../auth.js';
import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useLookup } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import { calculateEndDateFromService, formatScheduleDays } from '../utils/subscriptionDates.js';

const empty = {
  client: '',
  title: '',
  start_date: '',
  end_date: '',
  total_visits: 0,
  remaining_visits: 0,
  price: 0,
  paid_amount: 0,
  purchase_date: '',
  status: 'active',
  branch: '',
  service: '',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const baseFields = [
  { name: 'title', label: 'Название' },
  { name: 'start_date', label: 'Дата начала', type: 'date' },
  { name: 'end_date', label: 'Дата окончания', type: 'date' },
  { name: 'purchase_date', label: 'Дата покупки', type: 'date' },
  { name: 'total_visits', label: 'Всего занятий', type: 'number' },
  { name: 'remaining_visits', label: 'Осталось занятий', type: 'number' },
  { name: 'price', label: 'Стоимость', type: 'number' },
  { name: 'paid_amount', label: 'Оплачено', type: 'number' },
  {
    name: 'status',
    label: 'Статус',
    type: 'select',
    options: [
      { value: 'active', label: 'Активен' },
      { value: 'paused', label: 'Пауза' },
      { value: 'expired', label: 'Истёк' },
      { value: 'cancelled', label: 'Отменён' },
    ],
  },
];

function Progress({ row }) {
  const total = Number(row.lessons_total ?? row.total_visits ?? 0);
  const left = Number(row.lessons_left ?? row.remaining_visits ?? 0);
  const used = Number(row.used_lessons ?? Math.max(total - left, 0));
  const percent = total ? Math.min((used / total) * 100, 100) : 0;

  return (
    <div className="w-44">
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Использовано {used} из {total}, осталось {left}</p>
    </div>
  );
}

export default function SubscriptionsPage() {
  const crud = useCrudResource('subscriptions/', { status: '', client: '', date_from: '', date_to: '', branch: '' });
  const { branchOptions } = useBranches();
  const { clientOptions } = useClientOptions();
  const { items: services } = useLookup('catalog-items/', { category: 'service', is_active: 'true' });
  const user = getStoredUser();
  const canEdit = canManageSubscriptions(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const totalPaid = crud.items.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  const serviceOptions = services.map((service) => ({
    value: String(service.id),
    label: `${service.name} · ${Number(service.price || 0).toLocaleString('ru-RU')} ₸${service.lessons_count ? ` · ${service.lessons_count} зан.` : ''}${service.validity_days ? ` · ${service.validity_days} дн.` : ''}`,
  }));
  const selectedService = services.find((item) => String(item.id) === String(form.service));
  const calculateEndDate = (startDate, service) => calculateEndDateFromService(startDate, service);
  const selectService = (value, current, update) => {
    const service = services.find((item) => String(item.id) === String(value));
    const startDate = current.start_date || todayIso();
    const endDate = calculateEndDate(startDate, service) || current.end_date;
    update({
      ...current,
      service: value,
      title: service?.name || current.title,
      price: service?.price ?? current.price,
      total_visits: service?.lessons_count ?? current.total_visits,
      remaining_visits: current.id ? current.remaining_visits : (service?.lessons_count ?? current.remaining_visits),
      paid_amount: current.id ? current.paid_amount : (service?.price ?? current.paid_amount),
      start_date: startDate,
      end_date: endDate,
    });
  };
  const changeStartDate = (value, current, update) => {
    const service = services.find((item) => String(item.id) === String(current.service));
    update({
      ...current,
      start_date: value,
      end_date: calculateEndDate(value, service) || current.end_date,
    });
  };
  const fields = [
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Выберите клиента' },
    { name: 'service', label: 'Услуга', type: 'select', options: [{ value: '', label: services.length ? 'Выберите услугу' : 'Нет добавленных услуг' }, ...serviceOptions], onChange: selectService },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из клиента' }, ...branchOptions] },
    ...baseFields
      .filter((field) => field.name !== 'title')
      .map((field) => {
        if (field.name === 'start_date') return { ...field, onChange: changeStartDate };
        if (field.name === 'end_date') {
          return {
            ...field,
            help: selectedService?.validity_days
              ? (selectedService?.schedule_days?.length
                ? `Дата окончания рассчитана по дням услуги: ${formatScheduleDays(selectedService.schedule_days)}. Можно изменить вручную.`
                : 'Дата окончания рассчитана по сроку действия услуги. Можно изменить вручную.')
              : '',
          };
        }
        return field;
      }),
  ];

  return (
    <>
      <PageHeader title="Абонементы" actionLabel="Добавить абонемент" onAction={canEdit ? () => { crud.setEditing({ ...empty, start_date: todayIso() }); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено за период: {money(totalPaid)}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'paused', label: 'Пауза' }, { value: 'expired', label: 'Истёк' }, { value: 'cancelled', label: 'Отменён' }]} />
        <SelectField label="Клиент" value={crud.filters.client} onChange={(value) => crud.setFilters({ ...crud.filters, client: value })} options={[{ value: '', label: 'Все' }, ...clientOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={[{ value: '', label: 'Все филиалы' }, ...branchOptions]} />
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(e) => crud.setFilters({ ...crud.filters, date_from: e.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(e) => crud.setFilters({ ...crud.filters, date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'client', header: 'Клиент', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || `#${row.client}`}</Link> },
        { key: 'title', header: 'Услуга / Вид абонемента', render: (row) => row.service_name || row.title },
        { key: 'lessons_total', header: 'Всего', render: (row) => row.lessons_total ?? row.total_visits },
        { key: 'lessons_left', header: 'Осталось', render: (row) => row.lessons_left ?? row.remaining_visits },
        { key: 'start_date', header: 'Дата начала' },
        { key: 'end_date', header: 'Дата окончания' },
        { key: 'status', header: 'Статус', render: (row) => {
          const today = todayIso();
          const left = Number(row.lessons_left ?? row.remaining_visits ?? 0);
          if (left <= 0 && Number(row.total_visits || row.lessons_total || 0) > 0) return <Badge value="expired">Закончились занятия</Badge>;
          if (row.end_date && row.end_date < today) return <Badge value="expired">Истёк</Badge>;
          return <Badge value={row.status} />;
        } },
        { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal title="Абонемент" open={crud.modalOpen} onClose={() => crud.setModalOpen(false)} fields={fields} form={form} setForm={setForm} saving={crud.saving} onSubmit={() => crud.save(form)} />
    </>
  );
}
