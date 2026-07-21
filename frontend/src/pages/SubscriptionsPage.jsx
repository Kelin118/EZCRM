import { Link } from 'react-router-dom';
import { useState } from 'react';

import api from '../api/axios.js';
import { canDeleteDangerous, canManageSubscriptions, getStoredUser } from '../auth.js';
import { Actions, Badge, CrudModal, Filters, Input, money, PageHeader, SelectField, showApiError, Table, useCrudResource } from './pageUtils.jsx';
import { useClientOptions, useLookup } from './lookupUtils.jsx';
import useBranches from '../hooks/useBranches.js';
import useDiscounts from '../hooks/useDiscounts.js';
import { calculateEndDateFromService, formatScheduleDays } from '../utils/subscriptionDates.js';
import { todayLocalDate } from '../utils/dateTime.js';
import { calculateDiscountAmount, calculateDiscountedTotal } from '../utils/discounts.js';
import SubscriptionAddonsSelect, { addonPayload, addonsTotal } from '../components/subscriptions/SubscriptionAddonsSelect.jsx';
import DiscountSelect from '../components/sales/DiscountSelect.jsx';
import usePaymentMethods from '../hooks/usePaymentMethods.js';

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
  addons: [],
  discount: '',
  payment_method: '',
  comment: '',
};

const todayIso = todayLocalDate;

const baseFields = [
  { name: 'title', label: 'Название' },
  { name: 'start_date', label: 'Дата начала', type: 'date' },
  { name: 'end_date', label: 'Дата окончания', type: 'date' },
  { name: 'purchase_date', label: 'Дата оплаты', type: 'date' },
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
  if (total <= 0) {
    return <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Абонемент по сроку</span>;
  }
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
  const crud = useCrudResource('subscriptions/', { status: '', client: '', service_type: '', date_from: '', date_to: '', branch: '' });
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentMethodOptions } = usePaymentMethods({ activeOnly: true });
  const { clientOptions } = useClientOptions();
  const { items: services } = useLookup('catalog-items/', { category: 'service', is_active: 'true' });
  const [addonCatalogItems, setAddonCatalogItems] = useState([]);
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const user = getStoredUser();
  const canEdit = canManageSubscriptions(user);
  const canDelete = canDeleteDangerous(user);
  const form = crud.editing || empty;
  const setForm = (value) => crud.setEditing(value);
  const totalPaid = crud.items.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
  const serviceOptions = services.map((service) => ({
    value: String(service.id),
    label: `${service.service_type === 'camp' ? '?????? ? ' : ''}${service.name} · ${Number(service.price || 0).toLocaleString('ru-RU')} ₸${service.lessons_count ? ` · ${service.lessons_count} зан.` : ''}${service.validity_days ? ` · ${service.validity_days} дн.` : ''}`,
  }));
  const selectedService = services.find((item) => String(item.id) === String(form.service));
  const currentAddonsTotal = addonsTotal(form.addons, addonCatalogItems);
  const subtotalPrice = Number(form.price || 0) + currentAddonsTotal;
  const { getDiscountById } = useDiscounts({ branch: form.branch });
  const selectedDiscount = getDiscountById(form.discount);
  const currentDiscountAmount = calculateDiscountAmount(subtotalPrice, selectedDiscount);
  const currentTotalPrice = calculateDiscountedTotal(subtotalPrice, selectedDiscount);
  const hasService = Boolean(form.service);
  const selectedAddons = addonPayload(form.addons);
  const calculateEndDate = (startDate, service) => calculateEndDateFromService(startDate, service);
  const selectService = (value, current, update) => {
    const service = services.find((item) => String(item.id) === String(value));
    const startDate = service ? (current.start_date || todayIso()) : '';
    const endDate = calculateEndDate(startDate, service) || current.end_date;
    update({
      ...current,
      service: value,
      title: service?.name || '',
      price: service?.price ?? 0,
      total_visits: service?.lessons_count ?? 0,
      remaining_visits: service ? (current.id ? current.remaining_visits : (service?.lessons_count ?? current.remaining_visits)) : 0,
      paid_amount: current.id || paymentTouched ? current.paid_amount : calculateDiscountedTotal(Number(service?.price || 0) + addonsTotal(current.addons, addonCatalogItems), getDiscountById(current.discount)),
      start_date: startDate,
      end_date: service ? endDate : '',
    });
  };
  const changeAddons = (value, current, update) => {
    const nextSubtotal = Number(current.price || 0) + addonsTotal(value, addonCatalogItems);
    update({
      ...current,
      addons: value,
      paid_amount: current.id || paymentTouched ? current.paid_amount : calculateDiscountedTotal(nextSubtotal, getDiscountById(current.discount)),
    });
  };
  const changeDiscount = (value, current, update) => {
    const discount = getDiscountById(value);
    const subtotal = Number(current.price || 0) + addonsTotal(current.addons, addonCatalogItems);
    update({
      ...current,
      discount: value,
      paid_amount: current.id || paymentTouched ? current.paid_amount : calculateDiscountedTotal(subtotal, discount),
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
  const notifyError = (message) => {
    window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
  };
  const notifySuccess = (message) => {
    window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
  };
  const numericBranchOrNull = (value) => (value && value !== 'all' && value !== 'unassigned' ? Number(value) : null);
  const saveSale = async () => {
    const current = crud.editing || empty;
    const addons = addonPayload(current.addons);
    const currentHasService = Boolean(current.service);
    const currentHasAddons = addons.length > 0;

    if (!currentHasService && !currentHasAddons) {
      notifyError('Выберите основную или дополнительную услугу.');
      return;
    }

    if (current.id || currentHasService) {
      const { comment, price_summary, ...payload } = current;
      await crud.save({ ...payload, addons });
      return;
    }

    if (Number(current.paid_amount || 0) > 0 && !current.payment_method) {
      notifyError('Выберите способ оплаты.');
      return;
    }

    setSavingSale(true);
    try {
      await api.post('addon-sales/', {
        client: current.client ? Number(current.client) : null,
        branch: numericBranchOrNull(current.branch),
        payment_method: current.payment_method ? Number(current.payment_method) : null,
        sale_date: current.purchase_date || todayIso(),
        discount: current.discount ? Number(current.discount) : null,
        items: addons,
        payment_amount: current.paid_amount,
        comment: current.comment || '',
      });
      crud.setModalOpen(false);
      crud.setEditing(null);
      setPaymentTouched(false);
      await crud.reload();
      notifySuccess('Дополнительные услуги проданы.');
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingSale(false);
    }
  };
  const fields = [
    { name: 'client', label: 'Клиент', type: 'client', options: clientOptions, placeholder: 'Выберите клиента' },
    { name: 'branch', label: 'Филиал', type: 'select', options: [{ value: '', label: 'Из клиента' }, ...branchOptions] },
    { name: 'service', label: 'Основная услуга', type: 'select', options: [{ value: '', label: 'Без основной услуги' }, ...serviceOptions], onChange: selectService },
    {
      name: 'addons',
      type: 'custom',
      render: (current, update) => (
        <SubscriptionAddonsSelect
          value={current.addons}
          onCatalogItemsChange={setAddonCatalogItems}
          onChange={(value) => changeAddons(value, current, update)}
        />
      ),
    },
    {
      name: 'discount',
      type: 'custom',
      className: '',
      render: (current, update) => (
        <DiscountSelect value={current.discount} onChange={(value) => changeDiscount(value, current, update)} branch={current.branch} />
      ),
    },
    ...baseFields
      .filter((field) => field.name !== 'title')
      .filter((field) => hasService || !['start_date', 'end_date', 'total_visits', 'remaining_visits', 'price', 'status'].includes(field.name))
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
        if (field.name === 'paid_amount') {
          return { ...field, onChange: (value, current, update) => { setPaymentTouched(true); update({ ...current, paid_amount: value }); } };
        }
        if (field.name === 'price') {
          return { ...field, label: 'Цена основной услуги' };
        }
        return field;
      }),
    { name: 'payment_method', label: 'Способ оплаты', type: 'select', options: [{ value: '', label: 'Выберите способ' }, ...paymentMethodOptions] },
    {
      name: 'price_summary',
      type: 'custom',
      render: () => (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          <p className="mb-2 text-slate-900">Стоимость</p>
          <p>Основная услуга: {money(form.price)}</p>
          <p>Дополнительные услуги: {money(currentAddonsTotal)}</p>
          <p>Промежуточный итог: {money(subtotalPrice)}</p>
          <p className="text-emerald-700">Скидка: −{money(currentDiscountAmount)}</p>
          <p className="mt-2 text-base text-slate-900">Итого: {money(currentTotalPrice)}</p>
        </div>
      ),
    },
    { name: 'comment', label: 'Комментарий', type: 'textarea' },
  ];

  return (
    <>
      <PageHeader title="Абонементы" actionLabel="Добавить абонемент" onAction={canEdit ? () => { setPaymentTouched(false); crud.setEditing({ ...empty, start_date: todayIso(), purchase_date: todayIso() }); crud.setModalOpen(true); } : undefined}>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">Оплачено за период: {money(totalPaid)}</span>
      </PageHeader>
      <Filters>
        <SelectField label="Статус" value={crud.filters.status} onChange={(value) => crud.setFilters({ ...crud.filters, status: value })} options={[{ value: '', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'paused', label: 'Пауза' }, { value: 'expired', label: 'Истёк' }, { value: 'cancelled', label: 'Отменён' }]} />
        <SelectField label="??? ??????" value={crud.filters.service_type} onChange={(value) => crud.setFilters({ ...crud.filters, service_type: value })} options={[{ value: '', label: '???' }, { value: 'course', label: '??????? ????' }, { value: 'camp', label: '??????' }]} />
        <SelectField label="Клиент" value={crud.filters.client} onChange={(value) => crud.setFilters({ ...crud.filters, client: value })} options={[{ value: '', label: 'Все' }, ...clientOptions]} />
        <SelectField label="Филиал" value={crud.filters.branch || 'all'} onChange={(value) => crud.setFilters({ ...crud.filters, branch: value })} options={branchFilterOptions} />
        <Input label="Дата от" type="date" value={crud.filters.date_from} onChange={(e) => crud.setFilters({ ...crud.filters, date_from: e.target.value })} />
        <Input label="Дата до" type="date" value={crud.filters.date_to} onChange={(e) => crud.setFilters({ ...crud.filters, date_to: e.target.value })} />
      </Filters>
      <Table data={crud.items} columns={[
        { key: 'client', header: 'Клиент', render: (row) => <Link className="text-brand hover:underline" to={`/clients/${row.client}`}>{row.client_name || `#${row.client}`}</Link> },
        { key: 'title', header: 'Услуга / Вид абонемента', render: (row) => (
          <div>
            <p>{row.service_name || row.title}</p>
            {row.addons?.length ? <p className="text-xs font-semibold text-slate-500">+ {row.addons.length} доп. услуги</p> : null}
          </div>
        ) },
        { key: 'service_type', header: '???', render: (row) => <Badge value={row.service_type}>{row.service_type === 'camp' ? '??????' : '??????? ????'}</Badge> },
        { key: 'lessons_total', header: 'Всего', render: (row) => row.lessons_total ?? row.total_visits },
        { key: 'lessons_left', header: 'Осталось', render: (row) => row.lessons_left ?? row.remaining_visits },
        { key: 'progress', header: '????????', render: (row) => <Progress row={row} /> },
        { key: 'start_date', header: 'Дата начала' },
        { key: 'end_date', header: 'Дата окончания' },
        { key: 'status', header: 'Статус', render: (row) => {
          const today = todayIso();
          const left = Number(row.lessons_left ?? row.remaining_visits ?? 0);
          if (left <= 0 && Number(row.total_visits || row.lessons_total || 0) > 0) return <Badge value="expired">Закончились занятия</Badge>;
          if (row.end_date && row.end_date < today) return <Badge value="expired">Истёк</Badge>;
          return <Badge value={row.status} />;
        } },
        { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
        { key: 'price', header: 'Стоимость', render: (row) => (
          <div className="text-sm">
            <p>Осн.: {money(row.price)}</p>
            <p>Доп.: {money(row.addons_total)}</p>
            <p className="font-bold">Итого: {money(row.total_price)}</p>
          </div>
        ) },
        { key: 'paid_amount', header: 'Оплачено', render: (row) => money(row.paid_amount) },
        { key: 'actions', header: '', render: (row) => <Actions canEdit={canEdit} canDelete={canDelete} onEdit={() => { setPaymentTouched(true); crud.setEditing(row); crud.setModalOpen(true); }} onDelete={() => crud.remove(row.id)} /> },
      ]} />
      <CrudModal
        title={hasService ? 'Добавить абонемент' : selectedAddons.length ? 'Продать дополнительные услуги' : 'Продажа услуги'}
        open={crud.modalOpen}
        onClose={() => crud.setModalOpen(false)}
        fields={fields}
        form={form}
        setForm={setForm}
        saving={crud.saving || savingSale}
        onSubmit={saveSale}
      />
    </>
  );
}
