from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .employee_worklog import build_employee_worklog
from .models import (
    Branch,
    Client,
    EmployeePayrollProfile,
    EmployeeWorkSchedule,
    FinanceTransaction,
    Lesson,
    MasterClass,
    MasterClassStaffAssignment,
    PaymentMethod,
    PayrollStatement,
    StudyGroup,
)


def aware_dt(year, month, day, hour=0, minute=0):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


class PayrollWorklogApiTests(APITestCase):
    def setUp(self):
        timezone.activate('Asia/Qyzylorda')
        User = get_user_model()
        self.admin = User.objects.create_user(username='pay-admin', password='pass', role='admin', roles=['admin'])
        self.accountant = User.objects.create_user(username='pay-accountant', password='pass', role='accountant', roles=['accountant'])
        self.manager = User.objects.create_user(username='pay-manager', password='pass', role='manager', roles=['manager'])
        self.teacher = User.objects.create_user(username='pay-teacher', password='pass', role='teacher', roles=['teacher'])
        self.other_teacher = User.objects.create_user(username='pay-teacher-2', password='pass', role='teacher', roles=['teacher'])
        self.assistant = User.objects.create_user(username='pay-assistant', password='pass', role='teacher', roles=['teacher'])
        self.branch = Branch.objects.create(name='Payroll Branch')
        self.cash = PaymentMethod.objects.create(name='Payroll cash', code='payroll_cash', is_cash=True)
        self.client_obj = Client.objects.create(first_name='Payroll', last_name='Client', manager=self.manager, branch=self.branch)
        EmployeeWorkSchedule.objects.create(employee=self.teacher, branch=self.branch, weekday=0, start_time=time(16), end_time=time(21), valid_from=date(2026, 8, 1))
        EmployeeWorkSchedule.objects.create(employee=self.assistant, branch=self.branch, weekday=0, start_time=time(18), end_time=time(19), valid_from=date(2026, 8, 1))
        EmployeePayrollProfile.objects.create(employee=self.teacher, pay_type='hourly', regular_hourly_rate=2000, outside_hourly_rate=3000, outside_master_class_bonus=1500)
        EmployeePayrollProfile.objects.create(employee=self.assistant, pay_type='hourly', regular_hourly_rate=1000, outside_hourly_rate=4000, outside_master_class_bonus=2000)

    def tearDown(self):
        timezone.deactivate()
        super().tearDown()

    def create_mc(self, starts_at, duration=60, stage='booked', teacher=None, is_extra_work=False):
        item = MasterClass.objects.create(
            title='Рисование',
            starts_at=starts_at,
            duration_minutes=duration,
            stage=stage,
            manager=self.manager,
            teacher=teacher or self.teacher,
            branch=self.branch,
            price=Decimal('10000.00'),
            payment_amount=Decimal('10000.00'),
            payment_date=date(2026, 8, 17),
            is_extra_work=is_extra_work,
        )
        item.participants.add(self.client_obj)
        return item

    def add_assignment(self, master_class, employee, role='assistant', is_extra_work=False, duration_minutes=None):
        return MasterClassStaffAssignment.objects.create(
            master_class=master_class,
            employee=employee,
            role=role,
            is_extra_work=is_extra_work,
            duration_minutes=duration_minutes,
        )

    def test_manual_finance_manager_is_editable_and_created_by_stays(self):
        self.client.force_authenticate(self.accountant)
        create = self.client.post('/api/finance/', {
            'transaction_type': 'income',
            'amount': '1000.00',
            'source': 'manual',
            'payment_method': self.cash.id,
            'manager': self.manager.id,
        }, format='json')
        transaction = FinanceTransaction.objects.get(pk=create.data['id'])

        response = self.client.patch(f'/api/finance/{transaction.id}/', {'manager': self.admin.id}, format='json')
        transaction.refresh_from_db()

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(transaction.manager_id, self.admin.id)
        self.assertEqual(transaction.created_by_id, self.accountant.id)

    def test_finance_manager_filter_uses_manager_not_created_by(self):
        FinanceTransaction.objects.create(transaction_type='income', amount=1000, source='manual', manager=self.manager, created_by=self.accountant, paid_at=timezone.now())
        self.client.force_authenticate(self.accountant)

        by_manager = self.client.get('/api/finance/', {'manager': self.manager.id})
        by_creator = self.client.get('/api/finance/', {'manager': self.accountant.id})

        self.assertEqual(len(by_manager.data), 1)
        self.assertEqual(len(by_creator.data), 0)

    def test_master_class_duration_validation(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/master-classes/', {'title': 'МК', 'client': self.client_obj.id, 'starts_at': '2026-08-17T16:00', 'duration_minutes': 0}, format='json')

        self.assertEqual(response.status_code, 400)

    def test_master_class_finance_inherits_manager_and_outside_filter_works(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/master-classes/', {
            'title': 'МК outside',
            'client': self.client_obj.id,
            'starts_at': '2026-08-17T15:59',
            'duration_minutes': 60,
            'manager': self.manager.id,
            'teacher': self.teacher.id,
            'payment_amount': '1000.00',
            'payment_method': self.cash.id,
            'is_extra_work': True,
        }, format='json')
        transaction = FinanceTransaction.objects.get(master_class_payment=response.data['id'])
        self.client.force_authenticate(self.accountant)

        filtered = self.client.get('/api/finance/', {'extra_master_class': 'true', 'teacher': self.teacher.id})

        self.assertEqual(transaction.manager_id, self.manager.id)
        self.assertEqual(len(filtered.data), 1)
        self.assertTrue(filtered.data[0]['master_class_is_extra_work'])
        self.assertTrue(filtered.data[0]['master_class_time_outside_regular_hours'])

    def test_schedule_overlap_is_rejected_and_other_weekday_allowed(self):
        self.client.force_authenticate(self.manager)
        bad = self.client.post('/api/employee-schedules/', {'employee': self.teacher.id, 'weekday': 0, 'start_time': '17:00', 'end_time': '20:00', 'valid_from': '2026-08-15'}, format='json')
        good = self.client.post('/api/employee-schedules/', {'employee': self.teacher.id, 'weekday': 1, 'start_time': '17:00', 'end_time': '20:00', 'valid_from': '2026-08-15'}, format='json')

        self.assertEqual(bad.status_code, 400)
        self.assertEqual(good.status_code, 201, good.data)

    def test_worklog_splits_partial_overlap(self):
        self.create_mc(aware_dt(2026, 8, 17, 15, 30), duration=60)

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17), employee=self.teacher.id)
        entry = data['entries'][0]

        self.assertEqual(entry['regular_minutes'], 30)
        self.assertEqual(entry['outside_minutes'], 30)
        self.assertFalse(entry['is_extra_work'])
        self.assertTrue(entry['time_outside_regular_hours'])

    def test_worklog_manual_extra_work_is_separate_from_physical_time(self):
        self.create_mc(aware_dt(2026, 8, 17, 18), duration=60, is_extra_work=True)

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17), employee=self.teacher.id)
        entry = data['entries'][0]

        self.assertTrue(entry['is_extra_work'])
        self.assertFalse(entry['time_outside_regular_hours'])

    def test_worklog_creates_entry_for_each_master_class_staff_assignment(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=120)
        self.add_assignment(item, self.teacher, role='lead')
        self.add_assignment(item, self.assistant, role='assistant', is_extra_work=True, duration_minutes=60)
        self.add_assignment(item, self.other_teacher, role='assistant')

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17))

        self.assertEqual(len(data['entries']), 3)
        self.assertEqual({entry['employee'] for entry in data['entries']}, {self.teacher.id, self.assistant.id, self.other_teacher.id})

    def test_worklog_employee_filter_returns_assistant_and_duration_override(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=120)
        self.add_assignment(item, self.teacher, role='lead')
        assistant_assignment = self.add_assignment(item, self.assistant, role='assistant', is_extra_work=True, duration_minutes=60)

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17), employee=self.assistant.id)
        entry = data['entries'][0]

        self.assertEqual(len(data['entries']), 1)
        self.assertEqual(entry['employee'], self.assistant.id)
        self.assertEqual(entry['master_class_staff_assignment_id'], assistant_assignment.id)
        self.assertEqual(entry['staff_role'], 'assistant')
        self.assertEqual(entry['duration_minutes'], 60)
        self.assertTrue(entry['is_extra_work'])

    def test_worklog_uses_each_employee_personal_schedule(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=120)
        self.add_assignment(item, self.teacher, role='lead')
        self.add_assignment(item, self.assistant, role='assistant')

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17))
        by_employee = {entry['employee']: entry for entry in data['entries']}

        self.assertEqual(by_employee[self.teacher.id]['regular_minutes'], 120)
        self.assertEqual(by_employee[self.teacher.id]['outside_minutes'], 0)
        self.assertEqual(by_employee[self.assistant.id]['regular_minutes'], 60)
        self.assertEqual(by_employee[self.assistant.id]['outside_minutes'], 60)

    def test_worklog_missing_master_class_duration_warns_per_assignment(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=None)
        self.add_assignment(item, self.teacher, role='lead')
        self.add_assignment(item, self.assistant, role='assistant', duration_minutes=60)

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17))
        warning_entries = [entry for entry in data['entries'] if entry['warning']]

        self.assertEqual(len(data['entries']), 2)
        self.assertEqual(len(warning_entries), 1)
        self.assertEqual(warning_entries[0]['employee'], self.teacher.id)

    def test_cancelled_and_future_master_classes_do_not_count_as_fact(self):
        self.create_mc(aware_dt(2026, 8, 17, 16), duration=60, stage='cancelled')
        future = timezone.now().replace(microsecond=0) + timedelta(days=5)
        self.create_mc(future, duration=60, stage='booked')

        data = build_employee_worklog(date_from=timezone.localdate(), date_to=timezone.localdate() + timedelta(days=10), employee=self.teacher.id)

        self.assertEqual(data['summary']['total_minutes'], 0)

    def test_null_duration_adds_warning(self):
        self.create_mc(aware_dt(2026, 8, 17, 16), duration=None)

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17), employee=self.teacher.id)

        self.assertEqual(data['summary']['warning_count'], 1)

    def test_lesson_work_hours_count(self):
        group = StudyGroup.objects.create(name='Group', teacher=self.teacher, branch=self.branch)
        Lesson.objects.create(group=group, teacher=self.teacher, branch=self.branch, lesson_date=date(2026, 8, 17), start_time=time(16), end_time=time(17))

        data = build_employee_worklog(date_from=date(2026, 8, 17), date_to=date(2026, 8, 17), employee=self.teacher.id, source='lesson')

        self.assertEqual(data['summary']['regular_minutes'], 60)

    def test_payroll_generate_approve_and_mark_paid_is_idempotent(self):
        self.create_mc(aware_dt(2026, 8, 17, 15, 30), duration=60, is_extra_work=True)
        self.client.force_authenticate(self.accountant)

        generated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}, format='json')
        statement_id = generated.data[0]['id']
        approved = self.client.post(f'/api/payroll/{statement_id}/approve/')
        paid = self.client.post(f'/api/payroll/{statement_id}/mark-paid/', {'payment_method': self.cash.id}, format='json')
        paid_again = self.client.post(f'/api/payroll/{statement_id}/mark-paid/', {'payment_method': self.cash.id}, format='json')
        statement = PayrollStatement.objects.get(pk=statement_id)

        self.assertEqual(generated.status_code, 201, generated.data)
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(paid.status_code, 200, paid.data)
        self.assertEqual(paid_again.status_code, 200, paid_again.data)
        self.assertEqual(FinanceTransaction.objects.filter(source='salary').count(), 1)
        self.assertEqual(statement.status, PayrollStatement.Status.PAID)
        self.assertEqual(statement.outside_master_class_count, 1)

    def test_payroll_bonus_counts_manual_extra_work_only(self):
        self.create_mc(aware_dt(2026, 8, 17, 15, 30), duration=60, is_extra_work=False)
        marked_inside = self.create_mc(aware_dt(2026, 8, 17, 18, 0), duration=60, is_extra_work=True)

        self.client.force_authenticate(self.accountant)
        generated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}, format='json')
        statement = PayrollStatement.objects.get(pk=generated.data[0]['id'])

        self.assertEqual(generated.status_code, 201, generated.data)
        self.assertEqual(statement.outside_master_class_count, 1)
        self.assertEqual(statement.master_class_bonus_amount, Decimal('1500.00'))
        self.assertEqual(marked_inside.id, MasterClass.objects.get(is_extra_work=True).id)

    def test_payroll_counts_assistant_hours_and_extra_bonus(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=120)
        self.add_assignment(item, self.teacher, role='lead', is_extra_work=False)
        self.add_assignment(item, self.assistant, role='assistant', is_extra_work=True, duration_minutes=60)
        self.client.force_authenticate(self.accountant)

        generated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.assistant.id}, format='json')
        statement = PayrollStatement.objects.get(pk=generated.data[0]['id'])

        self.assertEqual(generated.status_code, 201, generated.data)
        self.assertEqual(statement.regular_minutes, 60)
        self.assertEqual(statement.outside_master_class_count, 1)
        self.assertEqual(statement.master_class_bonus_amount, Decimal('2000.00'))

    def test_payroll_lead_without_extra_does_not_get_assistant_bonus(self):
        item = self.create_mc(aware_dt(2026, 8, 17, 18), duration=120)
        self.add_assignment(item, self.teacher, role='lead', is_extra_work=False)
        self.add_assignment(item, self.assistant, role='assistant', is_extra_work=True, duration_minutes=60)
        self.client.force_authenticate(self.accountant)

        generated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}, format='json')
        statement = PayrollStatement.objects.get(pk=generated.data[0]['id'])

        self.assertEqual(generated.status_code, 201, generated.data)
        self.assertEqual(statement.outside_master_class_count, 0)
        self.assertEqual(statement.master_class_bonus_amount, Decimal('0.00'))

    def test_master_class_pay_preview_returns_each_staff_member(self):
        self.client.force_authenticate(self.manager)

        response = self.client.post('/api/master-classes/pay-preview/', {
            'starts_at': '2026-08-17T18:00',
            'duration_minutes': 120,
            'staff_assignments': [
                {'employee': self.teacher.id, 'role': 'lead', 'is_extra_work': False, 'duration_minutes': None},
                {'employee': self.assistant.id, 'role': 'assistant', 'is_extra_work': True, 'duration_minutes': 60},
            ],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        by_employee = {item['employee']: item for item in response.data['items']}
        self.assertEqual(set(by_employee), {self.teacher.id, self.assistant.id})
        self.assertEqual(Decimal(by_employee[self.assistant.id]['extra_master_class_bonus']), Decimal('2000.00'))
        self.assertEqual(Decimal(by_employee[self.teacher.id]['extra_master_class_bonus']), Decimal('0.00'))

    def test_teacher_cannot_see_payroll(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.get('/api/payroll/')

        self.assertEqual(response.status_code, 403)
