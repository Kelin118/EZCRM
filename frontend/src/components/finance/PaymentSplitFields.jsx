import { Plus, Trash2 } from 'lucide-react';

import usePaymentMethods from '../../hooks/usePaymentMethods.js';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';

const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;

const normalizeParts = (value) => (Array.isArray(value) ? value : []).map((part) => ({
  payment_method: part.payment_method ? String(part.payment_method) : '',
  amount: part.amount ?? '',
}));

export function paymentPartsPayload(parts = []) {
  return normalizeParts(parts)
    .filter((part) => part.payment_method && Number(part.amount || 0) > 0)
    .map((part) => ({ payment_method: Number(part.payment_method), amount: String(part.amount) }));
}

export function paymentPartsTotal(parts = []) {
  return normalizeParts(parts).reduce((sum, part) => sum + Number(part.amount || 0), 0);
}

export function partsFromTransaction(item) {
  if (Array.isArray(item?.payment_parts) && item.payment_parts.length) {
    return item.payment_parts.map((part) => ({ payment_method: String(part.payment_method), amount: part.amount }));
  }
  if (item?.payment_method) {
    return [{ payment_method: String(item.payment_method), amount: item.amount ?? item.payment_amount ?? item.paid_amount ?? item.price ?? 0 }];
  }
  return [];
}

export default function PaymentSplitFields({ totalAmount, value, onChange, disabled = false }) {
  const { paymentMethods } = usePaymentMethods({ activeOnly: true });
  const parts = normalizeParts(value);
  const total = Number(totalAmount || 0);
  const paid = paymentPartsTotal(parts);
  const diff = Number((total - paid).toFixed(2));
  const selected = new Set(parts.map((part) => part.payment_method).filter(Boolean));
  const cashMethod = paymentMethods.find((method) => method.is_cash);
  const nonCashMethod = paymentMethods.find((method) => !method.is_cash);

  const updatePart = (index, patch) => {
    onChange(parts.map((part, idx) => (idx === index ? { ...part, ...patch } : part)));
  };
  const removePart = (index) => onChange(parts.filter((_, idx) => idx !== index));
  const addPart = (method = '') => onChange([...parts, { payment_method: method ? String(method) : '', amount: '' }]);
  const quickFill = () => {
    const next = [];
    if (cashMethod) next.push({ payment_method: String(cashMethod.id), amount: '' });
    if (nonCashMethod) next.push({ payment_method: String(nonCashMethod.id), amount: '' });
    onChange(next.length ? next : [{ payment_method: '', amount: '' }]);
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 md:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-800">Разбивка оплаты</p>
          <p className="text-xs font-medium text-slate-500">Сумма к оплате: {money(total)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!parts.length && <Button type="button" variant="secondary" onClick={quickFill} disabled={disabled}>Быстрые строки</Button>}
          <Button type="button" variant="secondary" onClick={() => addPart()} disabled={disabled}><Plus size={15} />Добавить способ оплаты</Button>
        </div>
      </div>
      {parts.length === 0 && total <= 0 && <p className="text-sm text-slate-500">Для нулевой оплаты разбивка не нужна.</p>}
      <div className="grid gap-2">
        {parts.map((part, index) => (
          <div key={`${part.payment_method}-${index}`} className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Способ
              <select
                value={part.payment_method}
                disabled={disabled}
                onChange={(event) => updatePart(index, { payment_method: event.target.value })}
                className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none"
              >
                <option value="">Выберите способ</option>
                {paymentMethods.map((method) => (
                  <option
                    key={method.id}
                    value={method.id}
                    disabled={selected.has(String(method.id)) && String(method.id) !== part.payment_method}
                  >
                    {method.name}{method.is_cash ? ' · наличные' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Сумма" type="number" value={part.amount} onChange={(event) => updatePart(index, { amount: event.target.value })} disabled={disabled} />
            <div className="flex items-end">
              <Button type="button" variant="secondary" onClick={() => removePart(index)} disabled={disabled}><Trash2 size={15} /></Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-3">
        <p>Оплачено: {money(paid)}</p>
        <p className={diff > 0 ? 'text-amber-700' : 'text-slate-700'}>Осталось: {money(Math.max(diff, 0))}</p>
        <p className={diff < 0 ? 'text-red-700' : 'text-slate-700'}>Переплата: {money(Math.max(-diff, 0))}</p>
      </div>
    </div>
  );
}
