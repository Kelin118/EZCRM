import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import PaymentSplitFields, { partsFromTransaction, paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import useBranches from '../hooks/useBranches.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';
import { businessMonthRange, todayLocalDate } from '../utils/dateTime.js';
import { Badge, Filters, Input, money, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useEmployeeOptions } from './lookupUtils.jsx';

const monthStart = () => businessMonthRange().date_from;
const monthEnd = () => businessMonthRange().date_to;
const minutes = (value) => `${Math.floor(Number(value || 0) / 60)} ч ${Number(value || 0) % 60} мин`;
const emptyPay = { payment_parts: [] };
const salesSources = [
  ['subscription', 'Абонементы'],
  ['trial', 'Пробники'],
  ['master_class', 'Мастер-классы'],
  ['product', 'Товары'],
  ['addon', 'Дополнительные услуги'],
  ['retail', 'Товары и услуги'],
  ['camp', 'Лагерь'],
  ['certificate', 'Сертификаты'],
];
const ruleLabels = {
  monthly_salary: 'Оклад',
  regular_hourly: 'Почасовая ставка',
  outside_hourly: 'Работа вне графика',
  outside_master_class_bonus: 'Доплата за МК вне графика',
  sales_percent: 'Процент от продаж',
};
const emptyRuleForm = {
  employee: '',
  valid_from: todayLocalDate(),
  monthly_salary: { enabled: false, amount: '' },
  regular_hourly: { enabled: false, amount: '' },
  outside_hourly: { enabled: false, amount: '' },
  outside_master_class_bonus: { enabled: false, amount: '' },
  sales_percent: { enabled: false, percent: '', sales_sources: ['subscription', 'trial', 'master_class'], sales_attribution: 'responsible_manager' },
};
const emptyAdvance = { employee: '', branch: '', amount: '', advance_date: todayLocalDate(), payment_parts: [], comment: '' };

const ruleSummary = (rules = []) => {
  const active = rules.filter((rule) => rule.is_active && !rule.valid_until);
  if (!active.length) return 'Не настроено';
  return active.map((rule) => {
    if (rule.rule_type === 'sales_percent') return `${ruleLabels[rule.rule_type]} ${rule.percent}%`;
    return `${ruleLabels[rule.rule_type]} ${money(rule.amount)}`;
  }).join(' · ');
};

const rulesFormFromEmployee = (employee, rules = []) => {
  const next = { ...emptyRuleForm, employee: String(employee?.value || employee?.id || ''), valid_from: todayLocalDate() };
  for (const rule of rules.filter((item) => item.is_active && !item.valid_until)) {
    if (rule.rule_type === 'sales_percent') {
      next.sales_percent = {
        enabled: true,
        percent: rule.percent || '',
        sales_sources: rule.sales_sources?.length ? rule.sales_sources : ['subscription', 'trial', 'master_class'],
        sales_attribution: rule.sales_attribution || 'responsible_manager',
      };
    } else if (next[rule.rule_type]) {
      next[rule.rule_type] = { enabled: true, amount: rule.amount || '' };
    }
  }
  return next;
};

const buildRulesPayload = (form) => {
  const rules = [];
  for (const type of ['monthly_salary', 'regular_hourly', 'outside_hourly', 'outside_master_class_bonus']) {
    if (form[type]?.enabled) rules.push({ rule_type: type, amount: form[type].amount });
  }
  if (form.sales_percent.enabled) {
    rules.push({
      rule_type: 'sales_percent',
      percent: form.sales_percent.percent,
      sales_sources: form.sales_percent.sales_sources,
      sales_attribution: form.sales_percent.sales_attribution,
    });
  }
  return rules;
};

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${active ? 'bg-brand text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-brand'}`}
    >
      {children}
    </button>
  );
}

function MoneyRow({ label, value, accent = false }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-slate-600">{label}</span>
      <span className={`font-black ${accent ? 'text-brand' : 'text-slate-900'}`}>{money(value)}</span>
    </div>
  );
}

export default function PayrollPage() {
  const [tab, setTab] = useState('calculation');
  const [filters, setFilters] = useState({ date_from: monthStart(), date_to: monthEnd(), branch: 'all', employee: '', status: '' });
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [rules, setRules] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [details, setDetails] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [payForm, setPayForm] = useState(emptyPay);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvance);
  const [generating, setGenerating] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [savingAdvance, setSavingAdvance] = useState(false);
  const { branchOptions, branchFilterOptions } = useBranches();
  const { options: paymentOptions } = usePaymentMethods({ activeOnly: true });
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager', 'teacher', 'accountant']);

  const employeeById = useMemo(() => new Map(employeeOptions.map((item) => [String(item.value), item])), [employeeOptions]);
  const rulesByEmployee = useMemo(() => {
    const map = new Map();
    for (const rule of rules) {
      const key = String(rule.employee);
      map.set(key, [...(map.get(key) || []), rule]);
    }
    return map;
  }, [rules]);

  const loadPayroll = async () => {
    const { data } = await api.get('payroll/', { params: filters });
    setItems(Array.isArray(data) ? data : data.results || []);
  };
  const loadSettings = async () => {
    const [profilesResponse, rulesResponse] = await Promise.all([
      api.get('employee-payroll-profiles/'),
      api.get('employee-payroll-rules/'),
    ]);
    setProfiles(Array.isArray(profilesResponse.data) ? profilesResponse.data : profilesResponse.data.results || []);
    setRules(Array.isArray(rulesResponse.data) ? rulesResponse.data : rulesResponse.data.results || []);
  };
  const loadAdvances = async () => {
    const { data } = await api.get('payroll-advances/', { params: { employee: filters.employee, branch: filters.branch } });
    setAdvances(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => { loadPayroll().catch(showApiError); }, [filters]);
  useEffect(() => { loadSettings().catch(showApiError); }, []);
  useEffect(() => { loadAdvances().catch(showApiError); }, [filters.employee, filters.branch]);

  const refreshAll = async () => {
    await Promise.all([loadPayroll(), loadSettings(), loadAdvances()]);
  };

  const generate = async () => {
    if (generating) return;
    if (!filters.date_from || !filters.date_to || filters.date_to < filters.date_from) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Укажите корректный период.' }));
      return;
    }
    try {
      setGenerating(true);
      await api.post('payroll/generate/', {
        date_from: filters.date_from,
        date_to: filters.date_to,
        branch: filters.branch || 'all',
        ...(filters.employee ? { employee: filters.employee } : {}),
      });
      await refreshAll();
    } catch (error) {
      showApiError(error);
    } finally {
      setGenerating(false);
    }
  };

  const action = async (row, name) => {
    try {
      await api.post(`payroll/${row.id}/${name}/`);
      await refreshAll();
    } catch (error) {
      showApiError(error);
    }
  };

  const pay = async () => {
    const amountToPay = Number(payTarget.amount_to_pay ?? payTarget.total_amount ?? 0);
    if (amountToPay > 0 && paymentPartsTotal(payForm.payment_parts) !== amountToPay) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Сумма выплат по способам должна совпадать с зарплатой.' }));
      return;
    }
    await api.post(`payroll/${payTarget.id}/mark-paid/`, amountToPay > 0 ? { payment_parts: paymentPartsPayload(payForm.payment_parts) } : {});
    setPayTarget(null);
    await refreshAll();
  };

  const openRuleModal = (employee) => {
    setRuleForm(rulesFormFromEmployee(employee, rulesByEmployee.get(String(employee.value)) || []));
    setRuleModalOpen(true);
  };
  const saveRules = async () => {
    setSavingRules(true);
    try {
      await api.post('employee-payroll-profiles/configure-rules/', {
        employee: ruleForm.employee,
        valid_from: ruleForm.valid_from || todayLocalDate(),
        rules: buildRulesPayload(ruleForm),
      });
      setRuleModalOpen(false);
      await loadSettings();
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingRules(false);
    }
  };

  const openAdvanceModal = (advance = null) => {
    setAdvanceForm(advance ? {
      id: advance.id,
      employee: String(advance.employee),
      branch: advance.branch ? String(advance.branch) : '',
      amount: advance.amount,
      advance_date: advance.advance_date || todayLocalDate(),
      payment_parts: partsFromTransaction(advance),
      comment: advance.comment || '',
    } : emptyAdvance);
    setAdvanceModalOpen(true);
  };
  const saveAdvance = async () => {
    const amount = Number(advanceForm.amount || 0);
    if (amount <= 0) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Сумма аванса должна быть больше нуля.' }));
      return;
    }
    if (paymentPartsTotal(advanceForm.payment_parts) !== amount) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Сумма оплат по способам должна совпадать с авансом.' }));
      return;
    }
    setSavingAdvance(true);
    try {
      const payload = {
        employee: advanceForm.employee,
        branch: advanceForm.branch || null,
        amount: advanceForm.amount,
        advance_date: advanceForm.advance_date || todayLocalDate(),
        payment_parts: paymentPartsPayload(advanceForm.payment_parts),
        comment: advanceForm.comment || '',
      };
      if (advanceForm.id) await api.patch(`payroll-advances/${advanceForm.id}/`, payload);
      else await api.post('payroll-advances/', payload);
      setAdvanceModalOpen(false);
      await refreshAll();
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingAdvance(false);
    }
  };
  const deleteAdvance = async (advance) => {
    if (!window.confirm(`Удалить аванс на ${money(advance.amount)}?\n\nСвязанная финансовая операция также будет удалена.`)) return;
    try {
      await api.delete(`payroll-advances/${advance.id}/`);
      await refreshAll();
    } catch (error) {
      showApiError(error);
    }
  };

  const profileRows = employeeOptions.map((employee) => {
    const profile = profiles.find((item) => String(item.employee) === String(employee.value));
    const employeeRules = rulesByEmployee.get(String(employee.value)) || [];
    return { id: employee.value, employee_name: employee.label, profile, rules: employeeRules };
  });

  return (
    <>
      <PageHeader
        title="Зарплата"
        actionLabel={tab === 'calculation' ? (generating ? 'Рассчитываем...' : 'Рассчитать зарплату') : tab === 'advances' ? 'Выдать аванс' : undefined}
        onAction={tab === 'calculation' ? generate : tab === 'advances' ? () => openAdvanceModal() : undefined}
        actionDisabled={generating}
      />
      <div className="mb-5 inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <TabButton active={tab === 'calculation'} onClick={() => setTab('calculation')}>Расчёт</TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Настройки начислений</TabButton>
        <TabButton active={tab === 'advances'} onClick={() => setTab('advances')}>Авансы</TabButton>
      </div>

      {tab === 'calculation' && (
        <>
          <Filters>
            <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
            <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
            <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
            <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
            <SelectField label="Статус" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: '', label: 'Все' }, { value: 'draft', label: 'Черновик' }, { value: 'approved', label: 'Утверждён' }, { value: 'paid', label: 'Выплачен' }]} />
          </Filters>
          <Table data={items} columns={[
            { key: 'employee_name', header: 'Сотрудник' },
            { key: 'period', header: 'Период', render: (row) => `${row.date_from}–${row.date_to}` },
            { key: 'gross_amount', header: 'Начислено', render: (row) => money(row.gross_amount) },
            { key: 'sales_basis_amount', header: 'Продажи', render: (row) => money(row.sales_basis_amount) },
            { key: 'sales_commission_amount', header: '% с продаж', render: (row) => money(row.sales_commission_amount) },
            { key: 'advance_amount', header: 'Авансы', render: (row) => money(row.advance_amount) },
            { key: 'amount_to_pay', header: 'К выплате', render: (row) => money(row.amount_to_pay ?? row.total_amount) },
            { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
            { key: 'actions', header: '', render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDetails(row)}>Детали</Button>
                {row.status === 'draft' && <Button variant="secondary" onClick={() => action(row, 'recalculate')}>Пересчитать</Button>}
                {row.status === 'draft' && <Button onClick={() => action(row, 'approve')}>Утвердить</Button>}
                {row.status === 'approved' && <Button onClick={() => { setPayTarget(row); setPayForm(emptyPay); }}>{Number(row.amount_to_pay ?? row.total_amount ?? 0) > 0 ? 'Выплатить' : 'Закрыть'}</Button>}
              </div>
            ) },
          ]} />
        </>
      )}

      {tab === 'settings' && (
        <Table data={profileRows} columns={[
          { key: 'employee_name', header: 'Сотрудник' },
          { key: 'rules', header: 'Настроенные способы заработка', nowrap: false, render: (row) => ruleSummary(row.rules) },
          { key: 'actions', header: '', render: (row) => <Button variant="secondary" onClick={() => openRuleModal({ value: row.id, label: row.employee_name })}>Настроить</Button> },
        ]} />
      )}

      {tab === 'advances' && (
        <>
          <Filters>
            <SelectField label="Филиал" value={filters.branch} onChange={(branch) => setFilters({ ...filters, branch })} options={branchFilterOptions} />
            <SelectField label="Сотрудник" value={filters.employee} onChange={(employee) => setFilters({ ...filters, employee })} options={[{ value: '', label: 'Все сотрудники' }, ...employeeOptions]} />
          </Filters>
          <Table data={advances} columns={[
            { key: 'advance_date', header: 'Дата' },
            { key: 'employee_name', header: 'Сотрудник' },
            { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Без филиала' },
            { key: 'amount', header: 'Сумма', render: (row) => money(row.amount) },
            { key: 'allocated_amount', header: 'Зачтено', render: (row) => money(row.allocated_amount) },
            { key: 'remaining_amount', header: 'Остаток', render: (row) => money(row.remaining_amount) },
            { key: 'comment', header: 'Комментарий', render: (row) => row.comment || '—' },
            { key: 'actions', header: '', render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => openAdvanceModal(row)}>Редактировать</Button>
                <Button variant="danger" onClick={() => deleteAdvance(row)}>Удалить</Button>
              </div>
            ) },
          ]} />
        </>
      )}

      <Modal title="Детализация зарплаты" open={Boolean(details)} onClose={() => setDetails(null)} size="wide">
        {details && (
          <div className="grid gap-5 text-sm font-semibold text-slate-700 lg:grid-cols-2">
            <div>
              <p className="text-xl font-black text-slate-900">{details.employee_name}</p>
              <p className="mt-1 text-slate-500">{details.date_from}–{details.date_to}</p>
              <div className="mt-4 rounded-2xl border border-slate-100 p-4">
                <p className="mb-2 font-black text-slate-900">Начисления</p>
                <MoneyRow label="Оклад" value={details.base_amount} />
                <MoneyRow label={`Почасовая · ${minutes(details.regular_minutes)}`} value={details.regular_amount} />
                <MoneyRow label={`Работа вне графика · ${minutes(details.outside_minutes)}`} value={details.outside_amount} />
                <MoneyRow label={`МК вне графика · ${details.outside_master_class_count}`} value={details.master_class_bonus_amount} />
                <MoneyRow label={`Продажи · ${money(details.sales_basis_amount)} · ${details.sales_transactions_count} оп.`} value={details.sales_commission_amount} />
                <MoneyRow label="Ручная корректировка" value={details.manual_adjustment} />
                <MoneyRow label="Начислено" value={details.gross_amount} accent />
              </div>
            </div>
            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-100 p-4">
                <p className="mb-2 font-black text-slate-900">Авансы</p>
                {details.advance_allocations?.length ? details.advance_allocations.map((allocation) => (
                  <MoneyRow key={allocation.id} label={allocation.advance_date} value={-Number(allocation.amount || 0)} />
                )) : <p className="text-slate-500">Авансы не зачтены.</p>}
                <MoneyRow label="К выплате" value={details.amount_to_pay ?? details.total_amount} accent />
              </div>
              <div className="rounded-2xl border border-slate-100 p-4">
                <p className="mb-2 font-black text-slate-900">Продажи для процента</p>
                {(details.calculation_breakdown?.sales_by_source || []).length ? details.calculation_breakdown.sales_by_source.map((item) => (
                  <div key={`${item.source}-${item.sales_basis_amount}`} className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
                    <span className="text-slate-600">{item.source_display}</span>
                    <span className="font-bold text-slate-900">{money(item.sales_basis_amount)} → {money(item.sales_commission_amount)}</span>
                  </div>
                )) : <p className="text-slate-500">Нет продаж по выбранным правилам.</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal title="Выплатить зарплату" open={Boolean(payTarget)} onClose={() => setPayTarget(null)} footer={<><Button variant="secondary" onClick={() => setPayTarget(null)}>Отмена</Button><Button onClick={pay}>{Number(payTarget?.amount_to_pay ?? payTarget?.total_amount ?? 0) > 0 ? 'Выплатить' : 'Закрыть без выплаты'}</Button></>}>
        {payTarget && Number(payTarget.amount_to_pay ?? payTarget.total_amount ?? 0) > 0 ? (
          <PaymentSplitFields totalAmount={payTarget.amount_to_pay ?? payTarget.total_amount} value={payForm.payment_parts} onChange={(payment_parts) => setPayForm({ ...payForm, payment_parts })} />
        ) : (
          <p className="text-sm font-semibold text-slate-600">К выплате 0 ₸. Statement будет закрыт без финансовой операции.</p>
        )}
      </Modal>

      <Modal title={`Настройки зарплаты${ruleForm.employee ? ` — ${employeeById.get(String(ruleForm.employee))?.label || ''}` : ''}`} open={ruleModalOpen} onClose={() => setRuleModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setRuleModalOpen(false)}>Отмена</Button><Button onClick={saveRules} disabled={savingRules}>{savingRules ? 'Сохраняем...' : 'Сохранить'}</Button></>} size="wide">
        <div className="grid gap-4">
          <Input label="Действует с" type="date" value={ruleForm.valid_from} onChange={(event) => setRuleForm({ ...ruleForm, valid_from: event.target.value })} />
          {[
            ['monthly_salary', 'Оклад', 'Сумма, ₸ / месяц'],
            ['regular_hourly', 'Почасовая ставка', '₸ / час'],
            ['outside_hourly', 'Работа вне графика', '₸ / час'],
            ['outside_master_class_bonus', 'Доплата за МК вне графика', '₸ / МК'],
          ].map(([key, label, inputLabel]) => (
            <div key={key} className="rounded-2xl border border-slate-100 p-4">
              <label className="flex items-center gap-3 font-bold text-slate-900">
                <input type="checkbox" checked={ruleForm[key].enabled} onChange={(event) => setRuleForm({ ...ruleForm, [key]: { ...ruleForm[key], enabled: event.target.checked } })} />
                {label}
              </label>
              {ruleForm[key].enabled && <Input className="mt-3" label={inputLabel} type="number" value={ruleForm[key].amount} onChange={(event) => setRuleForm({ ...ruleForm, [key]: { ...ruleForm[key], amount: event.target.value } })} />}
            </div>
          ))}
          <div className="rounded-2xl border border-slate-100 p-4">
            <label className="flex items-center gap-3 font-bold text-slate-900">
              <input type="checkbox" checked={ruleForm.sales_percent.enabled} onChange={(event) => setRuleForm({ ...ruleForm, sales_percent: { ...ruleForm.sales_percent, enabled: event.target.checked } })} />
              Процент от продаж
            </label>
            {ruleForm.sales_percent.enabled && (
              <div className="mt-3 grid gap-4">
                <Input label="Процент, %" type="number" value={ruleForm.sales_percent.percent} onChange={(event) => setRuleForm({ ...ruleForm, sales_percent: { ...ruleForm.sales_percent, percent: event.target.value } })} />
                <SelectField label="Продажа относится сотруднику по" value={ruleForm.sales_percent.sales_attribution} onChange={(value) => setRuleForm({ ...ruleForm, sales_percent: { ...ruleForm.sales_percent, sales_attribution: value } })} options={[{ value: 'responsible_manager', label: 'Ответственный менеджер' }, { value: 'created_by', label: 'Создатель операции' }]} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {salesSources.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={ruleForm.sales_percent.sales_sources.includes(value)}
                        onChange={(event) => {
                          const current = new Set(ruleForm.sales_percent.sales_sources);
                          if (event.target.checked) current.add(value);
                          else current.delete(value);
                          setRuleForm({ ...ruleForm, sales_percent: { ...ruleForm.sales_percent, sales_sources: Array.from(current) } });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal title={advanceForm.id ? 'Изменить аванс' : 'Выдать аванс'} open={advanceModalOpen} onClose={() => setAdvanceModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setAdvanceModalOpen(false)}>Отмена</Button><Button onClick={saveAdvance} disabled={savingAdvance}>{savingAdvance ? 'Сохраняем...' : 'Сохранить'}</Button></>} size="wide">
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Сотрудник" value={advanceForm.employee} onChange={(employee) => setAdvanceForm({ ...advanceForm, employee })} options={[{ value: '', label: 'Выберите сотрудника' }, ...employeeOptions]} />
            <SelectField label="Филиал" value={advanceForm.branch} onChange={(branch) => setAdvanceForm({ ...advanceForm, branch })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
            <Input label="Сумма" type="number" value={advanceForm.amount} onChange={(event) => setAdvanceForm({ ...advanceForm, amount: event.target.value })} />
            <Input label="Дата" type="date" value={advanceForm.advance_date} onChange={(event) => setAdvanceForm({ ...advanceForm, advance_date: event.target.value })} />
          </div>
          <PaymentSplitFields totalAmount={advanceForm.amount} value={advanceForm.payment_parts} onChange={(payment_parts) => setAdvanceForm({ ...advanceForm, payment_parts })} />
          {!paymentOptions.length && <p className="text-sm font-semibold text-amber-700">Способы оплаты не добавлены.</p>}
          <Input label="Комментарий" value={advanceForm.comment} onChange={(event) => setAdvanceForm({ ...advanceForm, comment: event.target.value })} />
        </div>
      </Modal>
    </>
  );
}
