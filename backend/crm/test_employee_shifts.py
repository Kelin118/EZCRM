from datetime import date, datetime, time, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .employee_worklog import build_employee_worklog, get_employee_schedule_context, schedule_for
from .models import AuditLog, Branch, EmployeeShift, EmployeeWorkSchedule, MasterClass


class EmployeeShiftTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.manager = user_model.objects.create_user(
            username='shift-manager', password='pass', role='manager', roles=['manager'],
        )
        self.teacher = user_model.objects.create_user(
            username='shift-teacher', password='pass', role='teacher', roles=['teacher'],
        )
        self.other_teacher = user_model.objects.create_user(
            username='other-shift-teacher', password='pass', role='teacher', roles=['teacher'],
        )
        self.branch = Branch.objects.create(name='Shift branch')
        self.other_branch = Branch.objects.create(name='Other shift branch')
        self.teacher.branch = self.branch
        self.teacher.save(update_fields=('branch',))
        self.template = EmployeeWorkSchedule.objects.create(
            employee=self.teacher,
            branch=self.branch,
            weekday=0,
            start_time=time(10),
            end_time=time(18),
            valid_from=date(2026, 1, 1),
        )
        self.client.force_authenticate(self.manager)

    def create_shift(self, shift_date, **overrides):
        values = {
            'employee': self.teacher,
            'branch': self.branch,
            'shift_date': shift_date,
            'start_time': time(14),
            'end_time': time(22),
            'is_working_day': True,
            'created_by': self.manager,
            'template_schedule': self.template,
        }
        values.update(overrides)
        return EmployeeShift.objects.create(**values)

    def test_two_different_mondays_are_independent_and_same_date_is_unique(self):
        first = self.create_shift(date(2026, 9, 21), start_time=time(10), end_time=time(18))
        second = self.create_shift(date(2026, 9, 28), start_time=time(14), end_time=time(22))
        self.assertNotEqual(first.pk, second.pk)
        duplicate = EmployeeShift(
            employee=self.teacher,
            shift_date=date(2026, 9, 21),
            start_time=time(9),
            end_time=time(17),
        )
        with self.assertRaises(ValidationError):
            duplicate.full_clean()

    def test_set_for_date_creates_then_updates_one_shift(self):
        day = timezone.localdate() + timedelta(days=7)
        payload = {
            'employee': self.teacher.pk,
            'shift_date': day.isoformat(),
            'branch': self.branch.pk,
            'start_time': '14:00',
            'end_time': '22:00',
            'is_working_day': True,
            'note': 'Первая версия',
        }
        created = self.client.post('/api/employee-shifts/set-for-date/', payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        payload.update(start_time='12:00', end_time='20:00', note='Обновлено')
        updated = self.client.post('/api/employee-shifts/set-for-date/', payload, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(EmployeeShift.objects.filter(employee=self.teacher, shift_date=day).count(), 1)
        shift = EmployeeShift.objects.get(employee=self.teacher, shift_date=day)
        self.assertEqual((shift.start_time, shift.end_time, shift.note), (time(12), time(20), 'Обновлено'))
        self.assertTrue(AuditLog.objects.filter(entity_type='EmployeeShift', entity_id=shift.pk).exists())

    def test_day_off_clears_times_and_overrides_only_exact_date(self):
        day = timezone.localdate() + timedelta(days=(7 - timezone.localdate().weekday()) % 7 + 7)
        response = self.client.post('/api/employee-shifts/set-for-date/', {
            'employee': self.teacher.pk,
            'shift_date': day.isoformat(),
            'branch': self.branch.pk,
            'start_time': '14:00',
            'end_time': '22:00',
            'is_working_day': False,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        shift = EmployeeShift.objects.get(employee=self.teacher, shift_date=day)
        self.assertIsNone(shift.start_time)
        self.assertIsNone(shift.end_time)
        self.assertFalse(schedule_for(self.teacher, day).is_working_day)
        next_same_weekday = day + timedelta(days=7)
        self.assertEqual(schedule_for(self.teacher, next_same_weekday).pk, self.template.pk)

    def test_resolved_week_uses_override_template_and_branch_fallback(self):
        override_day = date(2026, 9, 28)
        shift = self.create_shift(override_day, branch=None)
        response = self.client.get('/api/employee-shifts/resolved/', {
            'date_from': '2026-09-28',
            'date_to': '2026-10-04',
            'employee': self.teacher.pk,
            'branch': self.branch.pk,
        })
        self.assertEqual(response.status_code, 200, response.data)
        monday = next(row for row in response.data if row['shift_date'] == override_day.isoformat())
        self.assertEqual(monday['source'], 'override')
        self.assertEqual(monday['shift_id'], shift.pk)
        self.assertEqual(monday['template_schedule_id'], self.template.pk)
        self.assertEqual(monday['branch'], self.branch.pk)
        self.assertEqual(monday['start_time'], '14:00:00')
        excluded = self.client.get('/api/employee-shifts/resolved/', {
            'date_from': '2026-09-28',
            'date_to': '2026-10-04',
            'employee': self.teacher.pk,
            'branch': self.other_branch.pk,
        })
        self.assertEqual(excluded.data, [])

        template_response = self.client.get('/api/employee-shifts/resolved/', {
            'date_from': '2026-09-21', 'date_to': '2026-09-27', 'employee': self.teacher.pk,
        })
        template_monday = next(row for row in template_response.data if row['shift_date'] == '2026-09-21')
        self.assertEqual(template_monday['source'], 'template')
        self.assertEqual(template_monday['start_time'], '10:00:00')

    def test_delete_override_resets_to_template(self):
        day = timezone.localdate() + timedelta(days=(7 - timezone.localdate().weekday()) % 7 + 7)
        shift = self.create_shift(day)
        self.assertEqual(schedule_for(self.teacher, day).pk, shift.pk)
        response = self.client.delete(f'/api/employee-shifts/{shift.pk}/')
        self.assertEqual(response.status_code, 204, getattr(response, 'data', None))
        self.assertEqual(schedule_for(self.teacher, day).pk, self.template.pk)
        self.assertTrue(AuditLog.objects.filter(
            entity_type='EmployeeShift', entity_id=shift.pk, description__icontains='возвращена к шаблону',
        ).exists())

    def test_template_versioning_and_exact_override_coexist(self):
        self.template.valid_until = date(2026, 9, 30)
        self.template.save(update_fields=('valid_until', 'updated_at'))
        newer = EmployeeWorkSchedule.objects.create(
            employee=self.teacher,
            branch=self.branch,
            weekday=0,
            start_time=time(12),
            end_time=time(20),
            valid_from=date(2026, 10, 1),
        )
        override = self.create_shift(date(2026, 10, 5), start_time=time(14), end_time=time(22), template_schedule=newer)
        self.assertEqual(schedule_for(self.teacher, date(2026, 9, 28)).start_time, time(10))
        self.assertEqual(schedule_for(self.teacher, date(2026, 10, 5)).pk, override.pk)
        self.assertEqual(schedule_for(self.teacher, date(2026, 10, 12)).start_time, time(12))

    def test_worklog_and_manager_context_use_exact_shift(self):
        self.create_shift(date(2026, 9, 21), start_time=time(14), end_time=time(22))
        starts_at = timezone.make_aware(datetime(2026, 9, 21, 13))
        master_class = MasterClass.objects.create(
            title='Shift integration', starts_at=starts_at, duration_minutes=120,
            manager=self.teacher, teacher=self.teacher, branch=self.branch,
            stage=MasterClass.Stage.COMPLETED,
        )
        worklog = build_employee_worklog(
            date_from=date(2026, 9, 21), date_to=date(2026, 9, 21),
            employee=self.teacher.pk, include_future=True,
        )
        entry = next(item for item in worklog['entries'] if item['source_id'] == master_class.pk)
        self.assertEqual((entry['regular_minutes'], entry['outside_minutes']), (60, 60))
        context = get_employee_schedule_context(self.teacher, starts_at, 120)
        self.assertEqual(context['status'], 'partial')
        self.assertEqual((context['regular_minutes'], context['outside_minutes']), (60, 60))

    def test_day_off_override_marks_all_work_outside_schedule(self):
        self.create_shift(
            date(2026, 9, 21),
            is_working_day=False,
            start_time=None,
            end_time=None,
        )
        starts_at = timezone.make_aware(datetime(2026, 9, 21, 11))
        master_class = MasterClass.objects.create(
            title='Day off work', starts_at=starts_at, duration_minutes=60,
            manager=self.teacher, teacher=self.teacher, branch=self.branch,
            stage=MasterClass.Stage.COMPLETED,
        )
        context = get_employee_schedule_context(self.teacher, starts_at, 60)
        self.assertEqual(context['status'], 'day_off')
        split = build_employee_worklog(
            date_from=date(2026, 9, 21),
            date_to=date(2026, 9, 21),
            employee=self.teacher.pk,
            include_future=True,
        )
        entry = next(item for item in split['entries'] if item['source_id'] == master_class.pk)
        self.assertEqual((entry['regular_minutes'], entry['outside_minutes']), (0, 60))

    def test_teacher_is_read_only_and_only_sees_own_resolved_schedule(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.get('/api/employee-shifts/resolved/', {
            'date_from': '2026-09-21', 'date_to': '2026-09-27',
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({row['employee'] for row in response.data}, {self.teacher.pk})
        denied = self.client.post('/api/employee-shifts/set-for-date/', {
            'employee': self.teacher.pk,
            'shift_date': (timezone.localdate() + timedelta(days=7)).isoformat(),
            'start_time': '10:00', 'end_time': '18:00', 'is_working_day': True,
        }, format='json')
        self.assertEqual(denied.status_code, 403)

    def test_past_shift_cannot_be_changed_or_deleted(self):
        shift = self.create_shift(timezone.localdate() - timedelta(days=1))
        url = f'/api/employee-shifts/{shift.pk}/'
        self.assertEqual(self.client.patch(url, {'note': 'Нельзя'}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 400)
        shift.refresh_from_db()
        self.assertEqual(shift.note, '')

    def test_resolved_range_is_limited(self):
        response = self.client.get('/api/employee-shifts/resolved/', {
            'date_from': '2026-09-01', 'date_to': '2026-10-02',
        })
        self.assertEqual(response.status_code, 400)


class EmployeeShiftConcurrencyTests(TransactionTestCase):
    def test_simultaneous_set_for_date_keeps_one_shift(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Row-locking test requires PostgreSQL.')
        user_model = get_user_model()
        manager = user_model.objects.create_user(
            username='shift-concurrent-manager', password='pass', role='manager', roles=['manager'],
        )
        employee = user_model.objects.create_user(
            username='shift-concurrent-teacher', password='pass', role='teacher', roles=['teacher'],
        )
        shift_date = timezone.localdate() + timedelta(days=7)
        gate = Barrier(2)

        def send(hour):
            try:
                client = APIClient()
                client.force_authenticate(manager)
                gate.wait(timeout=10)
                return client.post('/api/employee-shifts/set-for-date/', {
                    'employee': employee.pk,
                    'shift_date': shift_date.isoformat(),
                    'start_time': f'{hour:02d}:00',
                    'end_time': f'{hour + 8:02d}:00',
                    'is_working_day': True,
                }, format='json').status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(send, (9, 12)))
        self.assertEqual(sorted(responses), [200, 201])
        self.assertEqual(EmployeeShift.objects.filter(employee=employee, shift_date=shift_date).count(), 1)
