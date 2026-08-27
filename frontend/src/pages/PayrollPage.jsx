import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import PaymentSplitFields, { paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import { Badge, Filters, Input, money, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const today = new Date();
const monthStart = () => new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = () => new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
const minutes = (value) => `${Math.floor(Number(value || 0) / 60)} ч ${Number(value || 0) % 60} мин`;
const emptyPay = { payment_method: '', payment_parts: [] };

export default function PayrollPage() {
  const [filters, setFilters] = useState({ date_from: monthStart(), date_to: monthEnd(), branch: 'all', employee: '', status: '' });
  const [items, setItems] = useState([]);
  const [details, setDetails] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [payForm, setPayForm] = useState(emptyPay);
  const { branchFilterOptions } = useBranches();
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher', 'accountant']);

  const load = async () => {
    const { data } = await api.get('payroll/', { params: filters });
    setItems(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => { load().catch(showApiError); }, [filters]);

  const generate = async () => {
    try {
      await api.post('payroll/generate/', filters);
      await load();
    } catch (error) {
      showApiError(error);
    }
  };

  const action = async (row, name) => {
    try {
      await api.post(`payroll/${row.id}/${name}/`);
      await load();
    } catch (error) {
      showApiError(error);
    }
  };

  const pay = async () => {
    if (paymentPartsTotal(payForm.payment_parts) !== Number(payTarget.total_amount || 0)) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Сумма выплат по способам должна совпадать с зарплатой.' }));
      return;
    }
    await api.post(`payroll/${payTarget.id}/mark-paid/`, { payment_parts: paymentPartsPayload(payForm.payment_parts) });
    setPayTarget(null);
    await load();
  };

  return (
    <>
      <PageHeader title="Зарплата" actionLabel="Рассчитать зарплату" onAction={generate} />
      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
        <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
        <SelectField label="Статус" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: '', label: 'Все' }, { value: 'draft', label: 'Черновик' }, { value: 'approved', label: 'Утверждён' }, { value: 'paid', label: 'Выплачен' }]} />
      </Filters>
      <Table data={items} columns={[
        { key: 'employee_name', header: 'Сотрудник' },
        { key: 'regular_minutes', header: 'Обычные часы', render: (row) => minutes(row.regular_minutes) },
        { key: 'outside_minutes', header: 'Вне графика', render: (row) => minutes(row.outside_minutes) },
        { key: 'outside_master_class_count', header: 'МК вне времени' },
        { key: 'regular_amount', header: 'Основная сумма', render: (row) => money(Number(row.base_amount || 0) + Number(row.regular_amount || 0)) },
        { key: 'outside_amount', header: 'Доплата', render: (row) => money(Number(row.outside_amount || 0) + Number(row.master_class_bonus_amount || 0)) },
        { key: 'manual_adjustment', header: 'Корректировка', render: (row) => money(row.manual_adjustment) },
        { key: 'total_amount', header: 'Итого', render: (row) => money(row.total_amount) },
        { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
        { key: 'actions', header: '', render: (row) => (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDetails(row)}>Детали</Button>
            {row.status === 'draft' && <Button variant="secondary" onClick={() => action(row, 'recalculate')}>Пересчитать</Button>}
            {row.status === 'draft' && <Button onClick={() => action(row, 'approve')}>Утвердить</Button>}
            {row.status === 'approved' && <Button onClick={() => { setPayTarget(row); setPayForm(emptyPay); }}>Выплатить</Button>}
          </div>
        ) },
      ]} />
      <Modal title="Детализация зарплаты" open={Boolean(details)} onClose={() => setDetails(null)}>
        {details && (
          <div className="grid gap-3 text-sm font-semibold text-slate-700">
            <p className="text-xl font-black text-slate-900">{details.employee_name}</p>
            <p>{details.date_from}–{details.date_to}</p>
            <p>Обычные часы: {minutes(details.regular_minutes)}</p>
            <p>Вне графика: {minutes(details.outside_minutes)}</p>
            <p>МК вне времени: {details.outside_master_class_count}</p>
            <p>Обычная ставка: {money(details.regular_hourly_rate_snapshot)} / ч</p>
            <p>Ставка вне графика: {money(details.outside_hourly_rate_snapshot)} / ч</p>
            <p>Доплата за МК: {money(details.outside_master_class_bonus_snapshot)} × {details.outside_master_class_count}</p>
            <p>Основная сумма: {money(Number(details.base_amount || 0) + Number(details.regular_amount || 0))}</p>
            <p>Доплата: {money(Number(details.outside_amount || 0) + Number(details.master_class_bonus_amount || 0))}</p>
            <p>Корректировка: {money(details.manual_adjustment)}</p>
            <p className="text-2xl font-black text-brand">Итого: {money(details.total_amount)}</p>
          </div>
        )}
      </Modal>
      <Modal title="Выплатить зарплату" open={Boolean(payTarget)} onClose={() => setPayTarget(null)} footer={<><Button variant="secondary" onClick={() => setPayTarget(null)}>Отмена</Button><Button onClick={pay}>Выплатить</Button></>}>
        {payTarget && <PaymentSplitFields totalAmount={payTarget.total_amount} value={payForm.payment_parts} onChange={(payment_parts) => setPayForm({ ...payForm, payment_parts })} />}
      </Modal>
    </>
  );
}
