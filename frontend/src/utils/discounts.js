export function normalizeDecimalString(value) {
  return String(value ?? '').trim().replace(',', '.');
}

export function parseDecimal(value) {
  const normalized = normalizeDecimalString(value);
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

export function formatDiscountValue(value) {
  const normalized = normalizeDecimalString(value);
  if (!normalized) return '0';
  const [integerPart, fractionPart = ''] = normalized.split('.');
  const trimmedFraction = fractionPart.replace(/0+$/, '');
  return trimmedFraction ? `${integerPart},${trimmedFraction}` : integerPart;
}

export function calculateDiscountAmount(subtotal, discount) {
  const base = roundMoney(subtotal);
  if (!discount || base <= 0) return 0;
  const value = parseDecimal(discount.value ?? discount.discount_value ?? 0);
  const rawAmount = discount.discount_type === 'percentage' ? (base * value) / 100 : value;
  return Math.min(Math.max(roundMoney(rawAmount), 0), base);
}

export function calculateDiscountedTotal(subtotal, discount) {
  return roundMoney(Math.max(roundMoney(subtotal) - calculateDiscountAmount(subtotal, discount), 0));
}

export function formatDiscountLabel(discount) {
  if (!discount) return 'Без скидки';
  const value = discount.value ?? discount.discount_value ?? 0;
  const suffix = discount.discount_type === 'percentage'
    ? `${formatDiscountValue(value)}%`
    : `${parseDecimal(value).toLocaleString('ru-RU')} ₸`;
  return `${discount.name || discount.discount_name || 'Скидка'} — ${suffix}`;
}
