const dayToWeekday = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

export const weekdayLabels = {
  monday: 'ПН',
  tuesday: 'ВТ',
  wednesday: 'СР',
  thursday: 'ЧТ',
  friday: 'ПТ',
  saturday: 'СБ',
  sunday: 'ВС',
};

export const weekdayOptions = Object.entries(weekdayLabels).map(([value, label]) => ({ value, label }));

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (date) => date.toISOString().slice(0, 10);

export function formatScheduleDays(days = []) {
  return (Array.isArray(days) ? days : []).map((day) => weekdayLabels[day]).filter(Boolean).join(', ');
}

export function calculateEndDateByWeekdays(startDate, lessonsCount, scheduleDays = []) {
  const date = toDate(startDate);
  const total = Number(lessonsCount || 0);
  const weekdays = new Set((Array.isArray(scheduleDays) ? scheduleDays : []).map((day) => dayToWeekday[day]).filter((day) => day !== undefined));
  if (!date || total <= 0 || !weekdays.size) return '';

  let matched = 0;
  let guard = 0;
  while (guard < 370) {
    if (weekdays.has(date.getDay())) {
      matched += 1;
      if (matched === total) return toIso(date);
    }
    date.setDate(date.getDate() + 1);
    guard += 1;
  }
  return '';
}

export function addValidityDays(startDate, days) {
  const date = toDate(startDate);
  const total = Number(days || 0);
  if (!date || total <= 0) return '';
  date.setDate(date.getDate() + total - 1);
  return toIso(date);
}

export function calculateEndDateFromService(startDate, service, groupScheduleDays = []) {
  const lessonsCount = service?.lessons_count || 0;
  return (
    calculateEndDateByWeekdays(startDate, lessonsCount, groupScheduleDays)
    || calculateEndDateByWeekdays(startDate, lessonsCount, service?.schedule_days)
    || addValidityDays(startDate, service?.validity_days)
    || addValidityDays(startDate, lessonsCount === 4 ? 28 : lessonsCount === 8 ? 31 : 0)
  );
}
