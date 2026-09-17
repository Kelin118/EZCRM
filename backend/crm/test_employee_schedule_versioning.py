from datetime import date, datetime, time, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .employee_worklog import build_employee_worklog, get_employee_schedule_context, schedule_for
from .models import AuditLog, Branch, Client, EmployeePayrollProfile, EmployeeWorkSchedule, MasterClass
from .payroll import calculate_payroll


class EmployeeScheduleVersioningTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.manager = user_model.objects.create_user(username='schedule-manager', password='pass', role='manager', roles=['manager'])
        self.teacher = user_model.objects.create_user(username='schedule-teacher', password='pass', role='teacher', roles=['teacher'])
        self.branch = Branch.objects.create(name='Schedule branch')
        self.client.force_authenticate(self.manager)
        self.future = timezone.localdate() + timedelta(days=7)
        self.monday = self.future + timedelta(days=(7 - self.future.weekday()) % 7)
        self.old = EmployeeWorkSchedule.objects.create(
            employee=self.teacher, branch=self.branch, weekday=0,
            start_time=time(10), end_time=time(18), valid_from=date(2026, 1, 1),
        )

    def change(self, day, **overrides):
        payload = {
            'employee': self.teacher.pk, 'weekday': 0, 'branch': self.branch.pk,
            'start_time': '12:00', 'end_time': '20:00', 'is_working_day': True,
            'effective_from': day.isoformat(),
        }
        payload.update(overrides)
        return self.client.post('/api/employee-schedules/set-from-date/', payload, format='json')

    def test_split_preserves_history_and_filters_effective_date(self):
        response = self.change(self.monday)
        self.assertEqual(response.status_code, 200, response.data)
        self.old.refresh_from_db()
        self.assertEqual(self.old.valid_until, self.monday - timedelta(days=1))
        self.assertEqual(schedule_for(self.teacher, date(2026, 8, 3)).start_time, time(10))
        self.assertEqual(schedule_for(self.teacher, self.monday).start_time, time(12))
        before = self.client.get('/api/employee-schedules/', {'employee': self.teacher.pk, 'effective_on': '2026-08-03'})
        after = self.client.get('/api/employee-schedules/', {'employee': self.teacher.pk, 'effective_on': self.monday.isoformat()})
        self.assertEqual([row['id'] for row in before.data], [self.old.pk])
        self.assertEqual([row['id'] for row in after.data], [response.data[0]['id']])
        self.assertTrue(AuditLog.objects.filter(entity_type='EmployeeWorkSchedule', changes__effective_from=self.monday.isoformat()).exists())

    def test_preplanned_version_is_preserved_and_same_day_reused(self):
        later = self.monday + timedelta(days=14)
        self.assertEqual(self.change(self.monday).status_code, 200)
        self.assertEqual(self.change(later, start_time='09:00', end_time='17:00').status_code, 200)
        middle = self.monday + timedelta(days=4)
        self.assertEqual(self.change(middle, start_time='14:00', end_time='22:00').status_code, 200)
        same = self.change(middle, start_time='13:00', end_time='21:00')
        self.assertEqual(same.status_code, 200, same.data)
        versions = list(EmployeeWorkSchedule.objects.filter(employee=self.teacher, weekday=0).order_by('valid_from'))
        self.assertEqual(len(versions), 4)
        self.assertEqual([row.valid_until for row in versions], [self.monday - timedelta(days=1), middle - timedelta(days=1), later - timedelta(days=1), None])
        self.assertEqual(versions[2].start_time, time(13))
        self.assertEqual(versions[3].start_time, time(9))

    def test_day_off_and_back_to_work(self):
        self.assertEqual(self.change(self.monday, is_working_day=False).status_code, 200)
        self.assertTrue(schedule_for(self.teacher, date(2026, 8, 3)).is_working_day)
        self.assertFalse(schedule_for(self.teacher, self.monday).is_working_day)
        later = self.monday + timedelta(days=7)
        self.assertEqual(self.change(later, is_working_day=True).status_code, 200)
        self.assertTrue(schedule_for(self.teacher, later).is_working_day)

    def test_historical_patch_delete_and_past_version_are_rejected(self):
        url = f'/api/employee-schedules/{self.old.pk}/'
        self.assertEqual(self.client.patch(url, {'start_time': '11:00'}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 400)
        self.assertEqual(self.change(date(2026, 8, 3)).status_code, 400)
        self.old.refresh_from_db()
        self.assertEqual(self.old.start_time, time(10))
        self.assertEqual(EmployeeWorkSchedule.objects.count(), 1)

    def test_invalid_effective_date_returns_400(self):
        response = self.client.get('/api/employee-schedules/', {'effective_on': '2026-02-30'})
        self.assertEqual(response.status_code, 400)

    def test_bulk_invalid_day_rolls_back_all_changes(self):
        response = self.change(self.monday, weekdays=[0, 7])
        self.assertEqual(response.status_code, 400)
        self.old.refresh_from_db()
        self.assertIsNone(self.old.valid_until)
        self.assertEqual(EmployeeWorkSchedule.objects.count(), 1)

    def test_past_worklog_and_future_master_class_use_own_versions(self):
        client = Client.objects.create(first_name='Schedule', last_name='Client', branch=self.branch)
        past = MasterClass.objects.create(
            title='Past', starts_at=timezone.make_aware(datetime(2026, 8, 3, 11)),
            duration_minutes=60, manager=self.teacher, teacher=self.teacher,
            branch=self.branch, stage=MasterClass.Stage.COMPLETED,
        )
        past.participants.add(client)
        EmployeePayrollProfile.objects.create(employee=self.teacher, regular_hourly_rate=2000, outside_hourly_rate=3000)
        before = build_employee_worklog(date_from=date(2026, 8, 3), date_to=date(2026, 8, 3), employee=self.teacher.pk)
        payroll_before = calculate_payroll(self.teacher, date(2026, 8, 3), date(2026, 8, 3))
        self.assertEqual(before['entries'][0]['regular_minutes'], 60)
        self.assertEqual(self.change(self.monday).status_code, 200)
        after = build_employee_worklog(date_from=date(2026, 8, 3), date_to=date(2026, 8, 3), employee=self.teacher.pk)
        payroll_after = calculate_payroll(self.teacher, date(2026, 8, 3), date(2026, 8, 3))
        self.assertEqual(after['entries'][0]['regular_minutes'], 60)
        self.assertEqual(payroll_after, payroll_before)
        future_start = timezone.make_aware(datetime.combine(self.monday, time(11)))
        context = get_employee_schedule_context(self.teacher, future_start, 120)
        self.assertEqual((context['regular_minutes'], context['outside_minutes']), (60, 60))


class EmployeeScheduleConcurrencyTests(TransactionTestCase):
    def test_simultaneous_changes_do_not_overlap(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Row-locking test requires PostgreSQL.')
        user_model = get_user_model()
        manager = user_model.objects.create_user(username='schedule-concurrent-manager', password='pass', role='manager', roles=['manager'])
        employee = user_model.objects.create_user(username='schedule-concurrent-employee', password='pass', role='teacher', roles=['teacher'])
        EmployeeWorkSchedule.objects.create(
            employee=employee, weekday=0, start_time=time(10), end_time=time(18), valid_from=date(2026, 1, 1),
        )
        day = timezone.localdate() + timedelta(days=7)
        day += timedelta(days=(7 - day.weekday()) % 7)
        gate = Barrier(2)

        def send(hour):
            try:
                client = APIClient()
                client.force_authenticate(manager)
                gate.wait(timeout=10)
                return client.post('/api/employee-schedules/set-from-date/', {
                    'employee': employee.pk, 'weekday': 0,
                    'start_time': f'{hour:02d}:00', 'end_time': f'{hour + 8:02d}:00',
                    'is_working_day': True, 'effective_from': day.isoformat(),
                }, format='json').status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(send, (9, 12)))
        self.assertEqual(responses, [200, 200])
        versions = list(EmployeeWorkSchedule.objects.filter(employee=employee, weekday=0).order_by('valid_from'))
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0].valid_until, day - timedelta(days=1))
        self.assertEqual(versions[1].valid_from, day)
