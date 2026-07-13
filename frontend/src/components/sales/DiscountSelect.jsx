import useDiscounts from '../../hooks/useDiscounts.js';

export default function DiscountSelect({ value = '', onChange, branch = '', label = 'Скидка', historicalDiscount = null }) {
  const { options } = useDiscounts({ branch });
  const hasHistorical = historicalDiscount?.id && !options.some((option) => String(option.value) === String(historicalDiscount.id));
  const mergedOptions = [
    { value: '', label: 'Без скидки' },
    ...(hasHistorical ? [{ value: String(historicalDiscount.id), label: `${historicalDiscount.name || historicalDiscount.discount_name} — историческая` }] : []),
    ...options,
  ];

  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <select
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
      >
        {mergedOptions.map((option) => (
          <option key={option.value || 'none'} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
