from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from .models import EmployeeWorkSchedule, Lesson, MasterClass, MasterClassStaffAssignment


EXCLUDED_MASTER_CLASS_STAGES = {'cancelled', 'lost', 'lead'}
REGULAR_MASTER_CLASS_START = time(16, 0)
REGULAR_MASTER_CLASS_END = time(21, 0)


def _aware_datetime(day, value):
    dt = datetime.combine(day, value)
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _local(value):
    return timezone.localtime(value) if timezone.is_aware(value) else value


def is_outside_regular_master_class_hours(starts_at):
    local_time = _local(starts_at).time()
    return local_time < REGULAR_MASTER_CLASS_START or local_time >= REGULAR_MASTER_CLASS_END


def schedule_for(employee, day):
    return EmployeeWorkSchedule.objects.filter(
        employee=employee,
        weekday=day.weekday(),
        valid_from__lte=day,
    ).filter(Q(valid_until__isnull=True) | Q(valid_until__gte=day)).order_by('-valid_from').first()


def split_work_interval_by_schedule(employee, start_at, end_at):
    if not employee or not start_at or not end_at or end_at <= start_at:
        return {'regular_minutes': 0, 'outside_minutes': 0}
    local_start = _local(start_at)
    local_end = _local(end_at)
    total = int((local_end - local_start).total_seconds() // 60)
    schedule = schedule_for(employee, local_start.date())
    if not schedule or not schedule.is_working_day:
        return {'regular_minutes': 0, 'outside_minutes': max(total, 0)}
    schedule_start = _aware_datetime(local_start.date(), schedule.start_time)
    schedule_end = _aware_datetime(local_start.date(), schedule.end_time)
    overlap_start = max(start_at, schedule_start)
    overlap_end = min(end_at, schedule_end)
    regular = max(0, int((overlap_end - overlap_start).total_seconds() // 60))
    return {'regular_minutes': regular, 'outside_minutes': max(total - regular, 0)}


def build_employee_worklog(*, date_from, date_to, employee=None, branch=None, source='all', include_future=False):
    now = timezone.now()
    entries = []
    warnings = 0

    if source in ('all', 'master_class'):
        master_classes = MasterClass.objects.select_related('teacher', 'branch').prefetch_related('participants', 'staff_assignments__employee').filter(
            starts_at__date__gte=date_from,
            starts_at__date__lte=date_to,
        ).exclude(stage__in=EXCLUDED_MASTER_CLASS_STAGES)
        if employee:
            master_classes = master_classes.filter(Q(teacher_id=employee) | Q(staff_assignments__employee_id=employee))
        if branch and branch != 'all':
            master_classes = master_classes.filter(branch__isnull=True) if branch == 'unassigned' else master_classes.filter(branch_id=branch)
        for item in master_classes.distinct():
            assignments = list(item.staff_assignments.all())
            if not assignments and item.teacher_id:
                assignments = [
                    MasterClassStaffAssignment(
                        id=None,
                        master_class=item,
                        employee=item.teacher,
                        role=MasterClassStaffAssignment.Role.LEAD,
                        is_extra_work=item.is_extra_work,
                        duration_minutes=None,
                    )
                ]
            if employee:
                assignments = [assignment for assignment in assignments if str(assignment.employee_id) == str(employee)]
            for assignment in assignments:
                staff_member = assignment.employee
                if not staff_member:
                    continue
                warning = ''
                duration = assignment.duration_minutes if assignment.duration_minutes is not None else item.duration_minutes
                end_at = item.starts_at + timedelta(minutes=duration) if duration else None
                if not duration:
                    warning = 'Длительность не указана'
                    regular = outside = 0
                    warnings += 1
                elif item.starts_at > now and not include_future:
                    warning = 'Запланировано'
                    regular = outside = 0
                else:
                    split = split_work_interval_by_schedule(staff_member, item.starts_at, end_at)
                    regular = split['regular_minutes']
                    outside = split['outside_minutes']
                entries.append({
                    'source': 'master_class',
                    'source_id': item.id,
                    'master_class_staff_assignment_id': assignment.id,
                    'staff_role': assignment.role,
                    'staff_role_display': assignment.get_role_display(),
                    'employee': staff_member.id,
                    'employee_name': staff_member.get_full_name() or staff_member.username,
                    'branch': item.branch_id,
                    'branch_name': item.branch.name if item.branch else '',
                    'date': _local(item.starts_at).date().isoformat(),
                    'starts_at': item.starts_at,
                    'ends_at': end_at,
                    'duration_minutes': duration or 0,
                    'regular_minutes': regular,
                    'outside_minutes': outside,
                    'is_extra_work': assignment.is_extra_work,
                    'time_outside_regular_hours': is_outside_regular_master_class_hours(item.starts_at),
                    'outside_regular_master_class_hours': assignment.is_extra_work,
                    'title': item.title,
                    'warning': warning,
                })

    if source in ('all', 'lesson'):
        lessons = Lesson.objects.select_related('teacher', 'branch', 'group').filter(
            lesson_date__gte=date_from,
            lesson_date__lte=date_to,
            teacher__isnull=False,
        ).exclude(status='cancelled')
        if employee:
            lessons = lessons.filter(teacher_id=employee)
        if branch and branch != 'all':
            lessons = lessons.filter(branch__isnull=True) if branch == 'unassigned' else lessons.filter(branch_id=branch)
        for item in lessons:
            warning = ''
            if not item.end_time:
                start_at = _aware_datetime(item.lesson_date, item.start_time or time.min)
                end_at = None
                duration = regular = outside = 0
                warning = 'Время окончания не указано'
                warnings += 1
            else:
                start_at = _aware_datetime(item.lesson_date, item.start_time)
                end_at = _aware_datetime(item.lesson_date, item.end_time)
                duration = max(0, int((end_at - start_at).total_seconds() // 60))
                if start_at > now and not include_future:
                    warning = 'Запланировано'
                    regular = outside = 0
                else:
                    split = split_work_interval_by_schedule(item.teacher, start_at, end_at)
                    regular = split['regular_minutes']
                    outside = split['outside_minutes']
            entries.append({
                'source': 'lesson',
                'source_id': item.id,
                'employee': item.teacher_id,
                'employee_name': item.teacher.get_full_name() or item.teacher.username,
                'branch': item.branch_id,
                'branch_name': item.branch.name if item.branch else '',
                'date': item.lesson_date.isoformat(),
                'starts_at': start_at,
                'ends_at': end_at,
                'duration_minutes': duration,
                'regular_minutes': regular,
                'outside_minutes': outside,
                'is_extra_work': False,
                'time_outside_regular_hours': False,
                'outside_regular_master_class_hours': False,
                'title': item.topic or (item.group.name if item.group else 'Занятие'),
                'warning': warning,
            })

    entries.sort(key=lambda item: (item['starts_at'] or timezone.now(), item['employee_name']))
    total_minutes = sum(item['regular_minutes'] + item['outside_minutes'] for item in entries)
    regular_minutes = sum(item['regular_minutes'] for item in entries)
    outside_minutes = sum(item['outside_minutes'] for item in entries)
    return {
        'date_from': date_from.isoformat(),
        'date_to': date_to.isoformat(),
        'summary': {
            'total_minutes': total_minutes,
            'regular_minutes': regular_minutes,
            'outside_minutes': outside_minutes,
            'warning_count': warnings,
        },
        'employees': [],
        'entries': entries,
    }
