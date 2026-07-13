const pad = (value) => String(value).padStart(2, '0');

export function normalizeTimeForInput(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

export function normalizeTimeForApi(value) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

export function normalizeDateForInput(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return [value.getFullYear(), pad(value.getMonth() + 1), pad(value.getDate())].join('-');
}

export function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${[
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')}T${[
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join(':')}`;
}

export function serializeDateTimeLocal(value) {
  if (!value) return null;
  if (typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function todayLocalDate() {
  return normalizeDateForInput(new Date());
}
