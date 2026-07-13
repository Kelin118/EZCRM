export function calculateDiscountAmount(subtotal, discount) {
  const base = Number(subtotal || 0);
  if (!discount || base <= 0) return 0;
  const value = Number(discount.value ?? discount.discount_value ?? 0);
  const amount = discount.discount_type === 'percentage' ? (base * value) / 100 : value;
  return Math.min(Math.max(amount, 0), base);
}

export function calculateDiscountedTotal(subtotal, discount) {
  return Math.max(Number(subtotal || 0) - calculateDiscountAmount(subtotal, discount), 0);
}

export function formatDiscountLabel(discount) {
  if (!discount) return 'Без скидки';
  const value = Number(discount.value ?? discount.discount_value ?? 0);
  const suffix = discount.discount_type === 'percentage' ? `${value}%` : `${value.toLocaleString('ru-RU')} ₸`;
  return `${discount.name || discount.discount_name || 'Скидка'} — ${suffix}`;
}
