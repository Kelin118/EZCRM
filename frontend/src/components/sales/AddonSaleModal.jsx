import { useEffect, useMemo, useState } from 'react';

import api from '../../api/axios.js';
import useBranches from '../../hooks/useBranches.js';
import usePaymentMethods from '../../hooks/usePaymentMethods.js';
import { todayLocalDate } from '../../utils/dateTime.js';
import ClientSelectWithCreate from '../clients/ClientSelectWithCreate.jsx';
import SubscriptionAddonsSelect, { addonPayload, addonsTotal } from '../subscriptions/SubscriptionAddonsSelect.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';

function errorMessage(error) {
  const data = error.response?.data;
  if (!data) return 'Не удалось продать доп. услугу.';
  if (typeof data === 'string') return data;
  if (data.detail) return data.detail;
  const firstKey = Object.keys(data)[0];
  const firstValue = data[firstKey];
  if (Array.isArray(firstValue)) return `${firstKey}: ${firstValue[0]}`;
  if (firstValue && typeof firstValue === 'object') return `${firstKey}: ${JSON.stringify(firstValue)}`;
  return firstValue ? `${firstKey}: ${firstValue}` : 'Проверьте заполнение формы.';
}

function notifySuccess(message) {
  window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
}

function notifyError(message) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}

const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;

export default function AddonSaleModal({ open, onClose, onSaved, initialClient = '' }) {
  const { branchOptions } = useBranches();
  const { options: paymentOptions } = usePaymentMethods({ activeOnly: true });
  const [client, setClient] = useState(initialClient ? String(initialClient) : '');
  const [branch, setBranch] = useState('');
  const [saleDate, setSaleDate] = useState(todayLocalDate());
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [comment, setComment] = useState('');
  const [addons, setAddons] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => addonsTotal(addons, catalogItems), [addons, catalogItems]);
  const selectedItems = addonPayload(addons);

  useEffect(() => {
    if (!open) return;
    setClient(initialClient ? String(initialClient) : '');
    setBranch('');
    setSaleDate(todayLocalDate());
    setPaymentMethod('');
    setPaymentAmount('');
    setComment('');
    setAddons([]);
    setCatalogItems([]);
    setPaymentTouched(false);
  }, [open, initialClient]);

  useEffect(() => {
    if (!open || paymentTouched) return;
    setPaymentAmount(total ? String(total) : '');
  }, [open, total, paymentTouched]);

  const handlePaymentAmount = (event) => {
    setPaymentTouched(true);
    setPaymentAmount(event.target.value);
  };

  const submit = async (event) => {
    event.preventDefault();
    const amount = Number(paymentAmount || 0);
    if (!selectedItems.length) {
      notifyError('Выберите хотя бы одну доп. услугу.');
      return;
    }
    if (amount > 0 && !paymentMethod) {
      notifyError('Выберите способ оплаты.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client: client ? Number(client) : null,
        branch: branch ? Number(branch) : null,
        payment_method: paymentMethod ? Number(paymentMethod) : null,
        sale_date: saleDate,
        items: selectedItems,
        payment_amount: paymentAmount === '' ? undefined : paymentAmount,
        comment,
      };
      const { data } = await api.post('addon-sales/', payload);
      notifySuccess('Доп. услуга продана.');
      onSaved?.(data);
      onClose?.();
    } catch (error) {
      notifyError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Продать доп. услугу"
      open={open}
      onClose={onClose}
      size="wide"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button type="submit" form="addon-sale-form" disabled={saving || !selectedItems.length}>
            {saving ? 'Сохраняем…' : 'Продать'}
          </Button>
        </>
      )}
    >
      <form id="addon-sale-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <ClientSelectWithCreate
          value={client}
          onChange={(value) => setClient(value)}
          label="Клиент"
          placeholder="Без клиента"
        />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Филиал
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
          >
            <option value="">Автоматически</option>
            {branchOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="md:col-span-2">
          <SubscriptionAddonsSelect value={addons} onChange={setAddons} onCatalogItemsChange={setCatalogItems} />
        </div>
        <Input label="Дата продажи" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Способ оплаты
          <select
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
          >
            <option value="">Выберите способ</option>
            {paymentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {Number(paymentAmount || 0) > 0 && !paymentMethod && (
            <span className="text-xs font-semibold text-amber-700">Для оплаченной продажи нужен способ оплаты.</span>
          )}
        </label>
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Итог</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{money(total)}</p>
        </div>
        <Input label="Оплата" type="number" min="0" step="0.01" value={paymentAmount} onChange={handlePaymentAmount} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
          Комментарий
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>
      </form>
    </Modal>
  );
}
