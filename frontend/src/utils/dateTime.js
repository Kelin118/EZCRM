const pad = (value) => String(value).padStart(2, '0');
export const BUSINESS_TIME_ZONE = 'Asia/Almaty';
const businessFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const offsetFormatter = new Intl.DateTimeFormat('en', { timeZone: BUSINESS_TIME_ZONE, timeZoneName: 'longOffset' });

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
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return value.slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(businessFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function serializeDateTimeLocal(value) {
  if (!value) return null;
  if (typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return null;
  const wallTime = Date.parse(`${value}Z`);
  if (Number.isNaN(wallTime)) return null;
  let timestamp = wallTime;
  // Resolve the offset on the event date, including historical timezone changes.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const name = offsetFormatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName').value;
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : 0;
    timestamp = wallTime - minutes * 60000;
  }
  const date = new Date(timestamp);
  return formatDateTimeLocal(date) === value.slice(0, 16) ? date.toISOString() : null;
}

export function todayLocalDate() {
  return formatDateTimeLocal(new Date()).slice(0, 10);
}

export function addCalendarDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessMonthRange(value = todayLocalDate()) {
  const [year, month] = value.split('-').map(Number);
  return { date_from: `${value.slice(0, 7)}-01`, date_to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
