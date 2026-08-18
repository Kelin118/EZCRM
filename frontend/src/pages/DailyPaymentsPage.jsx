import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import useBranches from '../hooks/useBranches.js';
import { Filters, Input, money, PageHeader, SelectField, showApiError } from './pageUtils.jsx';

const todayIso = () => new Date().toISOString().slice(0, 10);

function shiftDate(value, days) {
  const date = new Date(`${value || todayIso()}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function humanDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function BranchSummaryCard({ branch }) {
  const hasUnassigned = Number(branch.unassigned_income || 0) > 0;

  return (
    <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-card">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-400">Филиал</p>
      <h3 className="mt-1 text-2xl font-black text-slate-900">{branch.branch_name}</h3>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-3xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-500">Карта / безналичные</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{money(branch.card_income)}</p>
        </div>
        <div className="rounded-3xl bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-700">Наличные</p>
          <p className="mt-2 text-2xl font-black text-emerald-800">{money(branch.cash_income)}</p>
        </div>
        <div className="rounded-3xl bg-brand/10 p-4">
          <p className="text-sm font-semibold text-brand">Всего поступило</p>
          <p className="mt-2 text-2xl font-black text-brand">{money(branch.total_income)}</p>
        </div>
      </div>
      {hasUnassigned && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          <AlertTriangle size={18} />
          <span>Способ оплаты не указан: {money(branch.unassigned_income)}</span>
        </div>
      )}
      <p className="mt-4 text-sm font-semibold text-slate-500">Расходы за день: <span className="text-slate-900">{money(branch.expense_total)}</span></p>
    </section>
  );
}

export default function DailyPaymentsPage() {
  const [date, setDate] = useState(todayIso());
  const [branch, setBranch] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { branchFilterOptions } = useBranches();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get('reports/daily-payments/', { params: { date, branch } })
      .then(({ data: response }) => {
        if (mounted) setData(response);
      })
      .catch(showApiError)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [date, branch]);

  const totals = useMemo(() => data?.totals || {}, [data]);

  return (
    <>
      <PageHeader title="Сводка оплат">
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">{humanDate(date)}</span>
      </PageHeader>

      <Filters>
        <div className="flex items-end gap-2">
          <Button variant="secondary" className="h-11 w-11 p-0" onClick={() => setDate(shiftDate(date, -1))} title="Предыдущий день">
            <ArrowLeft size={17} />
          </Button>
          <Input label="Дата" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button variant="secondary" className="h-11 w-11 p-0" onClick={() => setDate(shiftDate(date, 1))} title="Следующий день">
            <ArrowRight size={17} />
          </Button>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" className="h-11" onClick={() => setDate(todayIso())}>Сегодня</Button>
        </div>
        <SelectField label="Филиал" value={branch} onChange={setBranch} options={branchFilterOptions} />
      </Filters>

      {loading ? (
        <div className="rounded-[24px] bg-white p-8 text-sm font-semibold text-slate-500 shadow-card">Загрузка сводки...</div>
      ) : (
        <div className="grid gap-5">
          {(data?.branches || []).map((item) => <BranchSummaryCard key={item.branch_id || 'unassigned'} branch={item} />)}
          {(!data?.branches || data.branches.length === 0) && (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500 shadow-card">
              <p className="font-semibold text-slate-700">За этот день оплат и расходов нет.</p>
            </div>
          )}
          <section className="rounded-[30px] bg-slate-950 p-6 text-white shadow-soft">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-white/45">Итого за день</p>
            <div className="mt-5 grid gap-4 md:grid-cols-5">
              <div><p className="text-sm text-white/60">Карта / безналичные</p><p className="mt-1 text-2xl font-black">{money(totals.card_income)}</p></div>
              <div><p className="text-sm text-white/60">Наличные</p><p className="mt-1 text-2xl font-black">{money(totals.cash_income)}</p></div>
              <div><p className="text-sm text-white/60">Поступило</p><p className="mt-1 text-2xl font-black">{money(totals.income_total)}</p></div>
              <div><p className="text-sm text-white/60">Расходы</p><p className="mt-1 text-2xl font-black">{money(totals.expense_total)}</p></div>
              <div><p className="text-sm text-white/60">После расходов</p><p className="mt-1 text-2xl font-black text-accent">{money(totals.net_total)}</p></div>
            </div>
            {Number(totals.unassigned_income || 0) > 0 && (
              <p className="mt-4 rounded-2xl bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-100">Способ оплаты не указан: {money(totals.unassigned_income)}</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
