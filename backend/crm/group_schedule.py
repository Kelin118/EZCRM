from datetime import timedelta

from django.utils import timezone

from .models import GroupMembership, Lesson, ScheduleSlot, Subscription, Visit


DAY_TO_WEEKDAY = {
    'monday': 0,
    'tuesday': 1,
    'wednesday': 2,
    'thursday': 3,
    'friday': 4,
    'saturday': 5,
    'sunday': 6,
}

WEEKDAY_TO_DAY = {value: key for key, value in DAY_TO_WEEKDAY.items()}

DAY_LABELS = {
    'monday': 'ПН',
    'tuesday': 'ВТ',
    'wednesday': 'СР',
    'thursday': 'ЧТ',
    'friday': 'ПТ',
    'saturday': 'СБ',
    'sunday': 'ВС',
}


def normalize_schedule_days(days):
    if not isinstance(days, list):
        return []
    normalized = []
    for day in days:
        value = str(day).strip().lower()
        if value in DAY_TO_WEEKDAY and value not in normalized:
            normalized.append(value)
    return normalized


def schedule_display(group):
    days = normalize_schedule_days(group.schedule_days)
    if not days or not group.start_time or not group.end_time:
        return ''
    day_text = ', '.join(DAY_LABELS[day] for day in days)
    return f'{day_text}  {group.start_time:%H:%M}-{group.end_time:%H:%M}'


def group_future_dates(group, count, start_date=None):
    days = normalize_schedule_days(group.schedule_days)
    if not days or not group.start_time or not group.end_time or count <= 0:
        return []
    weekdays = {DAY_TO_WEEKDAY[day] for day in days}
    current = start_date or timezone.localdate()
    dates = []
    guard = 0
    while len(dates) < count and guard < 370:
        if current.weekday() in weekdays:
            dates.append(current)
        current += timedelta(days=1)
        guard += 1
    return dates


def subscription_group(subscription):
    membership = (
        GroupMembership.objects.select_related('group')
        .filter(client=subscription.client, status=GroupMembership.Status.ACTIVE)
        .order_by('joined_at', 'id')
        .first()
    )
    return membership.group if membership else None


def subscription_used_lessons(subscription):
    return Visit.objects.filter(subscription=subscription, lesson_deducted=True).count()


def subscription_remaining_lessons(subscription):
    return max((subscription.total_visits or 0) - subscription_used_lessons(subscription), 0)


def subscription_expected_end_date(subscription):
    group = subscription_group(subscription)
    remaining = subscription_remaining_lessons(subscription)
    dates = group_future_dates(group, remaining) if group else []
    return dates[-1] if dates else None


def subscription_planned_lessons_left(subscription):
    group = subscription_group(subscription)
    if not group:
        return None
    return Lesson.objects.filter(
        group=group,
        lesson_date__gte=timezone.localdate(),
        start_time=group.start_time,
    ).count()


def sync_group_schedule_slots(group, old_schedule=None):
    days = normalize_schedule_days(group.schedule_days)
    if not days or not group.start_time or not group.end_time:
        return

    desired_weekdays = {DAY_TO_WEEKDAY[day] for day in days}
    old_days = normalize_schedule_days((old_schedule or {}).get('schedule_days', []))
    old_weekdays = {DAY_TO_WEEKDAY[day] for day in old_days}
    old_start_time = (old_schedule or {}).get('start_time')
    old_end_time = (old_schedule or {}).get('end_time')

    for weekday in desired_weekdays:
        slot = (
            ScheduleSlot.objects.filter(group=group, weekday=weekday, is_active=True)
            .filter(start_time=old_start_time, end_time=old_end_time)
            .first()
            if old_start_time and old_end_time
            else None
        )
        if not slot:
            slot = ScheduleSlot.objects.filter(
                group=group,
                weekday=weekday,
                start_time=group.start_time,
                end_time=group.end_time,
                is_active=True,
            ).first()
        if not slot:
            slot = ScheduleSlot(group=group, weekday=weekday)

        slot.subject = group.subject
        slot.teacher = group.teacher
        slot.room = group.room
        slot.start_time = group.start_time
        slot.end_time = group.end_time
        slot.is_active = True
        slot.save()

    removed_weekdays = old_weekdays - desired_weekdays
    if removed_weekdays and old_start_time and old_end_time:
        ScheduleSlot.objects.filter(
            group=group,
            weekday__in=removed_weekdays,
            start_time=old_start_time,
            end_time=old_end_time,
            is_active=True,
        ).update(is_active=False)
