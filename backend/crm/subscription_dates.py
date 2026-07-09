from datetime import timedelta

from .group_schedule import DAY_TO_WEEKDAY, normalize_schedule_days


def _end_date_by_days(start_date, lessons_count, schedule_days):
    days = normalize_schedule_days(schedule_days)
    weekdays = {DAY_TO_WEEKDAY[day] for day in days}
    if not weekdays or lessons_count <= 0:
        return None

    current = start_date
    matched = 0
    guard = 0
    while guard < 370:
        if current.weekday() in weekdays:
            matched += 1
            if matched == lessons_count:
                return current
        current += timedelta(days=1)
        guard += 1
    return None


def calculate_subscription_end_date(start_date, lessons_count=None, validity_days=None, group=None, service_schedule_days=None):
    if not start_date:
        return None

    lessons_count = int(lessons_count or 0)
    validity_days = int(validity_days or 0)

    if group and lessons_count > 0:
        end_date = _end_date_by_days(start_date, lessons_count, getattr(group, 'schedule_days', []))
        if end_date:
            return end_date

    if lessons_count > 0:
        end_date = _end_date_by_days(start_date, lessons_count, service_schedule_days or [])
        if end_date:
            return end_date

    if validity_days > 0:
        return start_date + timedelta(days=validity_days - 1)

    if lessons_count == 4:
        return start_date + timedelta(days=27)
    if lessons_count == 8:
        return start_date + timedelta(days=30)

    return None
