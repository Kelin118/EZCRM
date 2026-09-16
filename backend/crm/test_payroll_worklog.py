from datetime import date, datetime, time, timedelta, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.models import Sum
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from .employee_worklog import build_employee_worklog, get_employee_schedule_context
from .models import (
    Branch,
    Client,
    EmployeePayrollProfile,
    EmployeePayrollAdvance,
    EmployeePayrollRule,
    EmployeeWorkSchedule,
    FinancePaymentPart,
    FinanceTransaction,
    Lesson,
    MasterClass,
    MasterClassPayment,
    MasterClassStaffAssignment,
    MasterClassSubject,
    PaymentMethod,
    PayrollStatement,
    PayrollAdvanceAllocation,
    StudyGroup,
)
from .serializers import MasterClassSerializer


def aware_dt(year, month, day, hour=0, minute=0):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


class PayrollWorklogApiTests(APITestCase):
    def setUp(self):
        timezone.activate('Asia/Almaty')
        User = get_user_model()
        self.admin = User.objects.create_user(username='pay-admin', password='pass', role='admin', roles=['admin'])
        self.accountant = User.objects.create_user(username='pay-accountant', password='pass', role='accountant', roles=['accountant'])
        self.manager = User.objects.create_user(username='pay-manager', password='pass', role='manager', roles=['manager'])
        self.teacher = User.objects.create_user(username='pay-teacher', password='pass', role='teacher', roles=['teacher'])
        self.other_teacher = User.objects.create_user(username='pay-teacher-2', password='pass', role='teacher', roles=['teacher'])
        self.assistant = User.objects.create_user(username='pay-assistant', password='pass', role='teacher', roles=['teacher'])
        self.branch = Branch.objects.create(name='Payroll Branch')
        self.master_class_subject = MasterClassSubject.objects.create(name='МК')
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
            'subject': self.master_class_subject.id,
            'title': 'МК outside',
            'client': self.client_obj.id,
            'starts_at': '2026-08-17T15:59',
            'duration_minutes': 60,
            'manager': self.manager.id,
            'teacher': self.teacher.id,
            'price': '1000.00',
            'initial_payment': {
                'amount': '1000.00',
                'payment_date': '2026-08-17',
                'payment_parts': [{'payment_method': self.cash.id, 'amount': '1000.00'}],
            },
            'is_extra_work': True,
        }, format='json')
        payment = MasterClassPayment.objects.get(master_class_id=response.data['id'])
        transaction = payment.finance_transaction
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

    def test_worklog_uses_business_timezone_for_persisted_utc_master_class(self):
        EmployeeWorkSchedule.objects.create(
            employee=self.teacher,
            branch=self.branch,
            weekday=6,
            start_time=time(16),
            end_time=time(21),
            valid_from=date(2026, 9, 1),
        )
        self.create_mc(datetime(2026, 9, 13, 11, 59, tzinfo=datetime_timezone.utc), duration=60)

        data = build_employee_worklog(
            date_from=date(2026, 9, 13),
            date_to=date(2026, 9, 13),
            employee=self.teacher.id,
            include_future=True,
        )
        entry = data['entries'][0]

        self.assertEqual(entry['regular_minutes'], 60)
        self.assertEqual(entry['outside_minutes'], 0)
        self.assertFalse(entry['time_outside_regular_hours'])

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

    def test_payroll_generate_accepts_admin_and_accountant_frontend_payload(self):
        payload = {
            'date_from': '2026-08-17',
            'date_to': '2026-08-17',
            'branch': 'all',
            'employee': self.teacher.id,
            'status': '',
        }

        for user in (self.admin, self.accountant):
            with self.subTest(user=user.username):
                self.client.force_authenticate(user)
                response = self.client.post('/api/payroll/generate/', payload, format='json')

                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(len(response.data), 1)
                self.assertEqual(response.data[0]['employee'], self.teacher.id)

    def test_manager_cannot_generate_payroll(self):
        self.client.force_authenticate(self.manager)

        response = self.client.post('/api/payroll/generate/', {
            'date_from': '2026-08-17',
            'date_to': '2026-08-17',
            'employee': self.teacher.id,
        }, format='json')

        self.assertEqual(response.status_code, 403)

    def test_payroll_generate_rejects_invalid_period(self):
        self.client.force_authenticate(self.accountant)

        response = self.client.post('/api/payroll/generate/', {
            'date_from': '2026-08-18',
            'date_to': '2026-08-17',
            'employee': self.teacher.id,
        }, format='json')

        self.assertEqual(response.status_code, 400)

    def test_payroll_generate_selected_employee_only_and_no_duplicates(self):
        self.client.force_authenticate(self.accountant)
        payload = {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}

        first = self.client.post('/api/payroll/generate/', payload, format='json')
        second = self.client.post('/api/payroll/generate/', payload, format='json')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(len(first.data), 1)
        self.assertEqual(first.data[0]['id'], second.data[0]['id'])
        self.assertEqual(PayrollStatement.objects.filter(employee=self.teacher, date_from=date(2026, 8, 17), date_to=date(2026, 8, 17)).count(), 1)
        self.assertFalse(PayrollStatement.objects.filter(employee=self.assistant, date_from=date(2026, 8, 17), date_to=date(2026, 8, 17)).exists())

    def test_payroll_generate_does_not_overwrite_approved_statement(self):
        self.create_mc(aware_dt(2026, 8, 17, 16), duration=60)
        self.client.force_authenticate(self.accountant)
        generated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}, format='json')
        statement_id = generated.data[0]['id']
        approved = self.client.post(f'/api/payroll/{statement_id}/approve/')
        self.create_mc(aware_dt(2026, 8, 17, 17), duration=60)

        regenerated = self.client.post('/api/payroll/generate/', {'date_from': '2026-08-17', 'date_to': '2026-08-17', 'employee': self.teacher.id}, format='json')
        statement = PayrollStatement.objects.get(pk=statement_id)

        self.assertEqual(generated.status_code, 201, generated.data)
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(regenerated.status_code, 201, regenerated.data)
        self.assertEqual(regenerated.data[0]['id'], statement_id)
        self.assertEqual(statement.status, PayrollStatement.Status.APPROVED)
        self.assertEqual(statement.regular_minutes, 60)

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

    def replace_rules(self, employee, rules):
        profile, _ = EmployeePayrollProfile.objects.get_or_create(employee=employee)
        profile.rules.all().delete()
        created = []
        for rule in rules:
            created.append(EmployeePayrollRule.objects.create(profile=profile, valid_from=rule.pop('valid_from', date(2026, 8, 1)), **rule))
        return created

    def sale(self, *, employee=None, created_by=None, amount='100000.00', subtotal=None, source='subscription', paid_at=None, branch=None, parts=False):
        transaction = FinanceTransaction.objects.create(
            transaction_type=FinanceTransaction.Type.INCOME,
            amount=Decimal(amount),
            subtotal_amount=Decimal(subtotal or amount),
            discount_amount=(Decimal(subtotal) - Decimal(amount)) if subtotal else Decimal('0.00'),
            source=source,
            manager=employee or self.manager,
            created_by=created_by or self.accountant,
            branch=branch or self.branch,
            paid_at=paid_at or aware_dt(2026, 8, 17, 12),
        )
        if parts:
            FinancePaymentPart.objects.create(transaction=transaction, payment_method=self.cash, payment_method_name=self.cash.name, amount=Decimal(amount) / 2)
            card = PaymentMethod.objects.create(name=f'Payroll card {transaction.id}', code=f'payroll_card_{transaction.id}')
            FinancePaymentPart.objects.create(transaction=transaction, payment_method=card, payment_method_name=card.name, amount=Decimal(amount) / 2)
        return transaction

    def generate_statement(self, employee=None, *, date_from='2026-08-17', date_to='2026-08-17', branch=None):
        self.client.force_authenticate(self.accountant)
        payload = {'date_from': date_from, 'date_to': date_to, 'employee': (employee or self.teacher).id}
        if branch is not None:
            payload['branch'] = branch
        response = self.client.post('/api/payroll/generate/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return PayrollStatement.objects.get(pk=response.data[0]['id'])

    def test_composable_monthly_outside_and_sales_rules(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.MONTHLY_SALARY, 'amount': Decimal('200000.00')},
            {'rule_type': EmployeePayrollRule.RuleType.OUTSIDE_HOURLY, 'amount': Decimal('1500.00')},
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('5.00000'), 'sales_sources': ['subscription', 'master_class']},
        ])
        self.create_mc(aware_dt(2026, 8, 17, 1), duration=600)
        self.sale(employee=self.teacher, amount='800000.00', source='subscription')

        statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.base_amount, Decimal('200000.00'))
        self.assertEqual(statement.outside_amount, Decimal('15000.00'))
        self.assertEqual(statement.sales_basis_amount, Decimal('800000.00'))
        self.assertEqual(statement.sales_commission_amount, Decimal('40000.00'))
        self.assertEqual(statement.gross_amount, Decimal('255000.00'))
        self.assertEqual(statement.amount_to_pay, Decimal('255000.00'))

    def test_hourly_and_commission_rules_combine(self):
        for weekday in (1, 2, 3):
            EmployeeWorkSchedule.objects.create(employee=self.teacher, branch=self.branch, weekday=weekday, start_time=time(16), end_time=time(21), valid_from=date(2026, 8, 1))
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.REGULAR_HOURLY, 'amount': Decimal('2000.00')},
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('10.00000'), 'sales_sources': ['subscription']},
        ])
        group = StudyGroup.objects.create(name='Payroll hourly', teacher=self.teacher, branch=self.branch)
        for day in (17, 18, 19, 20):
            Lesson.objects.create(group=group, teacher=self.teacher, branch=self.branch, lesson_date=date(2026, 8, day), start_time=time(16), end_time=time(21))
        self.sale(employee=self.teacher, amount='100000.00', source='subscription')

        statement = self.generate_statement(self.teacher, date_from='2026-08-17', date_to='2026-08-20')

        self.assertEqual(statement.regular_minutes, 1200)
        self.assertEqual(statement.regular_amount, Decimal('40000.00'))
        self.assertEqual(statement.sales_commission_amount, Decimal('10000.00'))
        self.assertEqual(statement.gross_amount, Decimal('50000.00'))

    def test_sales_sources_attribution_mixed_payment_and_discount_basis(self):
        creator = self.other_teacher
        self.replace_rules(self.teacher, [
            {
                'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
                'percent': Decimal('5.00000'),
                'sales_sources': ['subscription', 'master_class'],
                'sales_attribution': EmployeePayrollRule.SalesAttribution.RESPONSIBLE_MANAGER,
            },
        ])
        self.sale(employee=self.teacher, created_by=creator, amount='80000.00', subtotal='100000.00', source='subscription', parts=True)
        self.sale(employee=self.teacher, amount='50000.00', source='master_class')
        self.sale(employee=self.teacher, amount='30000.00', source='product')
        self.sale(employee=self.manager, created_by=self.teacher, amount='40000.00', source='subscription')

        statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.sales_transactions_count, 2)
        self.assertEqual(statement.sales_basis_amount, Decimal('130000.00'))
        self.assertEqual(statement.sales_commission_amount, Decimal('6500.00'))

        self.replace_rules(self.teacher, [
            {
                'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
                'percent': Decimal('10.00000'),
                'sales_sources': ['subscription'],
                'sales_attribution': EmployeePayrollRule.SalesAttribution.CREATED_BY,
            },
        ])
        statement.delete()
        created_by_statement = self.generate_statement(self.teacher)
        self.assertEqual(created_by_statement.sales_basis_amount, Decimal('40000.00'))
        self.assertEqual(created_by_statement.sales_commission_amount, Decimal('4000.00'))

    def test_lesson_rate_counts_unique_completed_lessons(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.LESSON_RATE, 'amount': Decimal('3000.00')},
        ])
        group = StudyGroup.objects.create(name='Payroll lessons', teacher=self.teacher, branch=self.branch)
        for hour in (16, 17, 18):
            Lesson.objects.create(group=group, teacher=self.teacher, branch=self.branch, lesson_date=date(2026, 8, 17), start_time=time(hour), end_time=time(hour + 1))

        statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.lesson_count, 3)
        self.assertEqual(statement.lesson_amount, Decimal('9000.00'))
        self.assertEqual(statement.gross_amount, Decimal('9000.00'))
        lesson_snapshot = statement.payroll_rules_snapshot[0]
        self.assertEqual(lesson_snapshot['rule_type'], EmployeePayrollRule.RuleType.LESSON_RATE)
        self.assertEqual(lesson_snapshot['lesson_count'], 3)

    def test_lesson_rate_deduplicates_worklog_lesson_ids(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.LESSON_RATE, 'amount': Decimal('3000.00')},
        ])
        entry = {
            'source': 'lesson',
            'source_id': 15,
            'date': '2026-08-17',
            'warning': '',
            'duration_minutes': 60,
            'regular_minutes': 60,
            'outside_minutes': 0,
            'outside_regular_master_class_hours': False,
        }
        worklog = {
            'summary': {'regular_minutes': 120, 'outside_minutes': 0},
            'entries': [entry, {**entry}],
        }

        with patch('crm.payroll.build_employee_worklog', return_value=worklog):
            statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.lesson_count, 1)
        self.assertEqual(statement.lesson_amount, Decimal('3000.00'))

    def test_lesson_rate_ignores_warning_entries(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.LESSON_RATE, 'amount': Decimal('3000.00')},
        ])
        worklog = {
            'summary': {'regular_minutes': 0, 'outside_minutes': 0},
            'entries': [{
                'source': 'lesson',
                'source_id': 15,
                'date': '2026-08-17',
                'warning': 'Запланировано',
                'duration_minutes': 60,
                'regular_minutes': 0,
                'outside_minutes': 0,
                'outside_regular_master_class_hours': False,
            }],
        }

        with patch('crm.payroll.build_employee_worklog', return_value=worklog):
            statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.lesson_count, 0)
        self.assertEqual(statement.lesson_amount, Decimal('0.00'))

    def test_shift_lesson_and_multiple_sales_rules_are_additive(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.SHIFT_RATE, 'amount': Decimal('10000.00')},
            {'rule_type': EmployeePayrollRule.RuleType.LESSON_RATE, 'amount': Decimal('3000.00')},
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('5.00000'), 'sales_sources': ['subscription']},
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('10.00000'), 'sales_sources': ['master_class']},
        ])
        group = StudyGroup.objects.create(name='Payroll combo', teacher=self.teacher, branch=self.branch)
        for index in range(8):
            day = 17 + min(index, 4)
            Lesson.objects.create(group=group, teacher=self.teacher, branch=self.branch, lesson_date=date(2026, 8, day), start_time=time(16 + (index % 2)), end_time=time(17 + (index % 2)))
        self.sale(employee=self.teacher, amount='100000.00', source='subscription')
        self.sale(employee=self.teacher, amount='50000.00', source='master_class')

        statement = self.generate_statement(self.teacher, date_from='2026-08-17', date_to='2026-08-21')

        self.assertEqual(statement.shift_count, 5)
        self.assertEqual(statement.shift_amount, Decimal('50000.00'))
        self.assertEqual(statement.lesson_count, 8)
        self.assertEqual(statement.lesson_amount, Decimal('24000.00'))
        self.assertEqual(statement.sales_commission_amount, Decimal('10000.00'))
        self.assertEqual(statement.sales_basis_amount, Decimal('150000.00'))
        self.assertEqual(statement.sales_transactions_count, 2)
        self.assertEqual(statement.gross_amount, Decimal('84000.00'))

    def test_overlapping_sales_rules_add_commission_without_double_counting_basis(self):
        self.replace_rules(self.teacher, [
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('5.00000'), 'sales_sources': ['subscription']},
            {'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT, 'percent': Decimal('2.00000'), 'sales_sources': ['subscription']},
        ])
        self.sale(employee=self.teacher, amount='100000.00', source='subscription')

        statement = self.generate_statement(self.teacher)

        self.assertEqual(statement.sales_basis_amount, Decimal('100000.00'))
        self.assertEqual(statement.sales_transactions_count, 1)
        self.assertEqual(statement.sales_commission_amount, Decimal('7000.00'))
        sales_components = [item for item in statement.calculation_breakdown['components'] if item['type'] == 'sales_percent']
        self.assertEqual([Decimal(item['amount']) for item in sales_components], [Decimal('5000.00'), Decimal('2000.00')])

    def test_sales_rules_can_use_different_attribution_modes(self):
        self.replace_rules(self.teacher, [{
            'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
            'percent': Decimal('5.00000'),
            'sales_sources': ['subscription'],
            'sales_attribution': EmployeePayrollRule.SalesAttribution.RESPONSIBLE_MANAGER,
        }])
        self.replace_rules(self.other_teacher, [{
            'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
            'percent': Decimal('2.00000'),
            'sales_sources': ['subscription'],
            'sales_attribution': EmployeePayrollRule.SalesAttribution.CREATED_BY,
        }])
        self.sale(employee=self.teacher, created_by=self.other_teacher, amount='100000.00', source='subscription')

        responsible_statement = self.generate_statement(self.teacher)
        created_by_statement = self.generate_statement(self.other_teacher)

        self.assertEqual(responsible_statement.sales_commission_amount, Decimal('5000.00'))
        self.assertEqual(created_by_statement.sales_commission_amount, Decimal('2000.00'))

    def test_configure_rules_preserves_updates_and_deletes_individual_sales_rules(self):
        self.client.force_authenticate(self.accountant)
        first = self.client.post('/api/employee-payroll-profiles/configure-rules/', {
            'employee': self.teacher.id,
            'valid_from': '2026-09-01',
            'rules': [
                {'rule_type': 'sales_percent', 'percent': '5', 'sales_sources': ['subscription'], 'sales_attribution': 'responsible_manager'},
                {'rule_type': 'sales_percent', 'percent': '10', 'sales_sources': ['master_class'], 'sales_attribution': 'responsible_manager'},
                {'rule_type': 'sales_percent', 'percent': '3', 'sales_sources': ['product', 'addon'], 'sales_attribution': 'responsible_manager'},
            ],
        }, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        profile = EmployeePayrollProfile.objects.get(employee=self.teacher)
        original = list(profile.rules.filter(is_active=True, valid_until__isnull=True, rule_type='sales_percent').order_by('id'))
        self.assertEqual(len(original), 3)

        second = self.client.post('/api/employee-payroll-profiles/configure-rules/', {
            'employee': self.teacher.id,
            'valid_from': '2026-09-15',
            'rules': [
                {'id': original[0].id, 'rule_type': 'sales_percent', 'percent': '5', 'sales_sources': ['subscription'], 'sales_attribution': 'responsible_manager'},
                {'id': original[1].id, 'rule_type': 'sales_percent', 'percent': '12', 'sales_sources': ['master_class'], 'sales_attribution': 'responsible_manager'},
                {'id': original[2].id, 'rule_type': 'sales_percent', 'percent': '3', 'sales_sources': ['product', 'addon'], 'sales_attribution': 'responsible_manager'},
            ],
        }, format='json')
        self.assertEqual(second.status_code, 200, second.data)
        active = list(profile.rules.filter(is_active=True, valid_until__isnull=True, rule_type='sales_percent').order_by('id'))
        self.assertEqual(len(active), 3)
        self.assertIn(original[0].id, [rule.id for rule in active])
        self.assertIn(original[2].id, [rule.id for rule in active])
        self.assertNotIn(original[1].id, [rule.id for rule in active])
        changed = next(rule for rule in active if rule.percent == Decimal('12.00000'))

        third = self.client.post('/api/employee-payroll-profiles/configure-rules/', {
            'employee': self.teacher.id,
            'valid_from': '2026-09-20',
            'rules': [
                {'id': changed.id, 'rule_type': 'sales_percent', 'percent': '12', 'sales_sources': ['master_class'], 'sales_attribution': 'responsible_manager'},
                {'id': original[2].id, 'rule_type': 'sales_percent', 'percent': '3', 'sales_sources': ['product', 'addon'], 'sales_attribution': 'responsible_manager'},
            ],
        }, format='json')
        self.assertEqual(third.status_code, 200, third.data)
        remaining_ids = set(profile.rules.filter(is_active=True, valid_until__isnull=True, rule_type='sales_percent').values_list('id', flat=True))
        self.assertEqual(remaining_ids, {changed.id, original[2].id})

    def test_historical_statement_keeps_multiple_sales_rule_snapshot(self):
        self.client.force_authenticate(self.accountant)
        configured = self.client.post('/api/employee-payroll-profiles/configure-rules/', {
            'employee': self.teacher.id,
            'valid_from': '2026-09-01',
            'rules': [
                {'rule_type': 'sales_percent', 'percent': '5', 'sales_sources': ['subscription'], 'sales_attribution': 'responsible_manager'},
                {'rule_type': 'sales_percent', 'percent': '2', 'sales_sources': ['subscription'], 'sales_attribution': 'responsible_manager'},
            ],
        }, format='json')
        self.assertEqual(configured.status_code, 200, configured.data)
        profile = EmployeePayrollProfile.objects.get(employee=self.teacher)
        september_rules = list(profile.rules.filter(is_active=True, valid_until__isnull=True, rule_type='sales_percent').order_by('id'))
        self.sale(employee=self.teacher, amount='100000.00', source='subscription', paid_at=aware_dt(2026, 9, 10, 12))
        september = self.generate_statement(self.teacher, date_from='2026-09-01', date_to='2026-09-30')
        self.client.post(f'/api/payroll/{september.id}/approve/')

        updated = self.client.post('/api/employee-payroll-profiles/configure-rules/', {
            'employee': self.teacher.id,
            'valid_from': '2026-10-01',
            'rules': [
                {'id': september_rules[0].id, 'rule_type': 'sales_percent', 'percent': '7', 'sales_sources': ['subscription'], 'sales_attribution': 'responsible_manager'},
                {'rule_type': 'sales_percent', 'percent': '10', 'sales_sources': ['master_class'], 'sales_attribution': 'responsible_manager'},
            ],
        }, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.sale(employee=self.teacher, amount='100000.00', source='subscription', paid_at=aware_dt(2026, 10, 10, 12))
        self.sale(employee=self.teacher, amount='50000.00', source='master_class', paid_at=aware_dt(2026, 10, 10, 13))
        october = self.generate_statement(self.teacher, date_from='2026-10-01', date_to='2026-10-31')

        september.refresh_from_db()
        self.assertEqual(september.sales_commission_amount, Decimal('7000.00'))
        self.assertEqual([item['percent'] for item in september.payroll_rules_snapshot], ['5.00000', '2.00000'])
        self.assertEqual(october.sales_commission_amount, Decimal('12000.00'))

    def test_advance_reduces_final_salary_finance_expense(self):
        self.replace_rules(self.teacher, [{'rule_type': EmployeePayrollRule.RuleType.MONTHLY_SALARY, 'amount': Decimal('300000.00')}])
        self.client.force_authenticate(self.accountant)
        advance = self.client.post('/api/payroll-advances/', {
            'employee': self.teacher.id,
            'branch': self.branch.id,
            'amount': '50000.00',
            'advance_date': '2026-08-10',
            'payment_parts': [{'payment_method': self.cash.id, 'amount': '50000.00'}],
        }, format='json')
        statement = self.generate_statement(self.teacher, date_from='2026-08-01', date_to='2026-08-31', branch=self.branch.id)
        self.client.post(f'/api/payroll/{statement.id}/approve/')
        paid = self.client.post(f'/api/payroll/{statement.id}/mark-paid/', {
            'payment_parts': [{'payment_method': self.cash.id, 'amount': '250000.00'}],
        }, format='json')

        self.assertEqual(advance.status_code, 201, advance.data)
        statement.refresh_from_db()
        self.assertEqual(statement.gross_amount, Decimal('300000.00'))
        self.assertEqual(statement.advance_amount, Decimal('50000.00'))
        self.assertEqual(statement.amount_to_pay, Decimal('250000.00'))
        self.assertEqual(paid.status_code, 200, paid.data)
        self.assertEqual(FinanceTransaction.objects.filter(source='salary_advance').aggregate(total=Sum('amount'))['total'], Decimal('50000.00'))
        self.assertEqual(FinanceTransaction.objects.filter(source='salary').aggregate(total=Sum('amount'))['total'], Decimal('250000.00'))

    def test_advance_carryover_and_zero_final_payment(self):
        self.replace_rules(self.teacher, [{'rule_type': EmployeePayrollRule.RuleType.MONTHLY_SALARY, 'amount': Decimal('60000.00')}])
        self.client.force_authenticate(self.accountant)
        advance = self.client.post('/api/payroll-advances/', {
            'employee': self.teacher.id,
            'amount': '100000.00',
            'advance_date': '2026-08-01',
            'payment_parts': [{'payment_method': self.cash.id, 'amount': '100000.00'}],
        }, format='json')
        first = self.generate_statement(self.teacher, date_from='2026-08-01', date_to='2026-08-31')
        self.client.post(f'/api/payroll/{first.id}/approve/')
        first_paid = self.client.post(f'/api/payroll/{first.id}/mark-paid/', {}, format='json')

        self.replace_rules(self.teacher, [{'rule_type': EmployeePayrollRule.RuleType.MONTHLY_SALARY, 'amount': Decimal('100000.00'), 'valid_from': date(2026, 9, 1)}])
        second = self.generate_statement(self.teacher, date_from='2026-09-01', date_to='2026-09-30')

        self.assertEqual(advance.status_code, 201, advance.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.advance_amount, Decimal('60000.00'))
        self.assertEqual(first.amount_to_pay, Decimal('0.00'))
        self.assertEqual(first_paid.status_code, 200, first_paid.data)
        self.assertFalse(FinanceTransaction.objects.filter(source='salary').exists())
        self.assertEqual(second.advance_amount, Decimal('40000.00'))
        self.assertEqual(second.amount_to_pay, Decimal('60000.00'))
        self.assertEqual(EmployeePayrollAdvance.objects.get().allocations.aggregate(total=Sum('amount'))['total'], Decimal('100000.00'))

    def test_approved_statement_keeps_historical_rule_snapshot(self):
        self.replace_rules(self.teacher, [{
            'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
            'percent': Decimal('5.00000'),
            'sales_sources': ['subscription'],
            'valid_from': date(2026, 9, 1),
        }])
        self.sale(employee=self.teacher, amount='100000.00', source='subscription', paid_at=aware_dt(2026, 9, 10, 12))
        september = self.generate_statement(self.teacher, date_from='2026-09-01', date_to='2026-09-30')
        self.client.post(f'/api/payroll/{september.id}/approve/')
        self.replace_rules(self.teacher, [{
            'rule_type': EmployeePayrollRule.RuleType.SALES_PERCENT,
            'percent': Decimal('10.00000'),
            'sales_sources': ['subscription'],
            'valid_from': date(2026, 10, 1),
        }])
        self.sale(employee=self.teacher, amount='100000.00', source='subscription', paid_at=aware_dt(2026, 10, 10, 12))
        october = self.generate_statement(self.teacher, date_from='2026-10-01', date_to='2026-10-31')

        september.refresh_from_db()
        self.assertEqual(september.sales_commission_amount, Decimal('5000.00'))
        self.assertEqual(september.payroll_rules_snapshot[0]['percent'], '5.00000')
        self.assertEqual(october.sales_commission_amount, Decimal('10000.00'))

    def test_payroll_generate_rejects_overlapping_period(self):
        self.replace_rules(self.teacher, [{'rule_type': EmployeePayrollRule.RuleType.MONTHLY_SALARY, 'amount': Decimal('100000.00')}])
        self.generate_statement(self.teacher, date_from='2026-09-01', date_to='2026-09-30')
        self.client.force_authenticate(self.accountant)

        response = self.client.post('/api/payroll/generate/', {
            'date_from': '2026-09-15',
            'date_to': '2026-10-15',
            'employee': self.teacher.id,
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('пересекающийся период', response.data['detail'])

    def test_teacher_cannot_see_payroll(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.get('/api/payroll/')

        self.assertEqual(response.status_code, 403)


class MasterClassManagerScheduleContextTests(APITestCase):
    def setUp(self):
        timezone.activate('Asia/Almaty')
        User = get_user_model()
        self.admin = User.objects.create_user(username='mc-schedule-admin', password='pass', role='admin', roles=['admin'])
        self.manager = User.objects.create_user(username='mc-schedule-manager', password='pass', role='manager', roles=['manager'])
        self.other_manager = User.objects.create_user(username='mc-schedule-manager-2', password='pass', role='manager', roles=['manager'])
        self.branch = Branch.objects.create(name='Manager schedule branch')
        self.client_obj = Client.objects.create(first_name='Schedule', last_name='Client', branch=self.branch)
        self.client.force_authenticate(self.manager)

    def tearDown(self):
        timezone.deactivate()
        super().tearDown()

    def dt(self, year, month, day, hour=0, minute=0):
        return timezone.make_aware(datetime(year, month, day, hour, minute))

    def schedule(self, *, employee=None, weekday=0, start=time(10), end=time(20), valid_from=date(2026, 8, 1), valid_until=None, is_working_day=True):
        return EmployeeWorkSchedule.objects.create(
            employee=employee or self.manager,
            branch=self.branch,
            weekday=weekday,
            start_time=start,
            end_time=end,
            valid_from=valid_from,
            valid_until=valid_until,
            is_working_day=is_working_day,
        )

    def context(self, *, employee=None, starts_at=None, duration=60, cache=None):
        return get_employee_schedule_context(employee if employee is not None else self.manager, starts_at or self.dt(2026, 8, 17, 14), duration, schedule_cache=cache)

    def create_master_class(self, *, manager=None, starts_at=None, duration=60):
        item = MasterClass.objects.create(
            title='МК график куратора',
            manager=self.manager if manager is None else manager,
            starts_at=starts_at or self.dt(2026, 8, 17, 14),
            duration_minutes=duration,
            branch=self.branch,
        )
        item.participants.add(self.client_obj)
        return item

    def test_no_manager_status(self):
        data = get_employee_schedule_context(None, self.dt(2026, 8, 17, 14), 60)

        self.assertEqual(data['status'], 'no_manager')
        self.assertFalse(data['schedule_found'])

    def test_no_schedule_status(self):
        data = self.context()

        self.assertEqual(data['status'], 'no_schedule')
        self.assertFalse(data['schedule_found'])

    def test_day_off_status(self):
        self.schedule(weekday=0, is_working_day=False)

        data = self.context()

        self.assertEqual(data['status'], 'day_off')
        self.assertTrue(data['schedule_found'])
        self.assertFalse(data['is_working_day'])

    def test_within_schedule_status(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 14), duration=90)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['regular_minutes'], 90)
        self.assertEqual(data['outside_minutes'], 0)

    def test_outside_schedule_before_shift(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 8), duration=60)

        self.assertEqual(data['status'], 'outside_schedule')
        self.assertEqual(data['regular_minutes'], 0)
        self.assertEqual(data['outside_minutes'], 60)

    def test_outside_schedule_after_shift(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 21), duration=60)

        self.assertEqual(data['status'], 'outside_schedule')
        self.assertEqual(data['regular_minutes'], 0)
        self.assertEqual(data['outside_minutes'], 60)

    def test_partial_after_shift_end(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 19, 30), duration=90)

        self.assertEqual(data['status'], 'partial')
        self.assertEqual(data['regular_minutes'], 30)
        self.assertEqual(data['outside_minutes'], 60)

    def test_partial_before_shift_start(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 9, 30), duration=90)

        self.assertEqual(data['status'], 'partial')
        self.assertEqual(data['regular_minutes'], 60)
        self.assertEqual(data['outside_minutes'], 30)

    def test_starts_exactly_at_schedule_start_is_within(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 10), duration=60)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['regular_minutes'], 60)

    def test_ends_exactly_at_schedule_end_is_within(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 19), duration=60)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['regular_minutes'], 60)

    def test_starts_exactly_at_schedule_end_is_outside(self):
        self.schedule(weekday=0)

        data = self.context(starts_at=self.dt(2026, 8, 17, 20), duration=60)

        self.assertEqual(data['status'], 'outside_schedule')
        self.assertEqual(data['outside_minutes'], 60)

    def test_historical_master_class_uses_old_schedule(self):
        self.schedule(weekday=3, start=time(10), end=time(18), valid_from=date(2026, 8, 1), valid_until=date(2026, 8, 31))
        self.schedule(weekday=3, start=time(12), end=time(20), valid_from=date(2026, 9, 1))

        data = self.context(starts_at=self.dt(2026, 8, 20, 17, 30), duration=30)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['schedule_start'], '10:00')
        self.assertEqual(data['schedule_end'], '18:00')

    def test_new_master_class_uses_new_schedule(self):
        self.schedule(weekday=3, start=time(10), end=time(18), valid_from=date(2026, 8, 1), valid_until=date(2026, 8, 31))
        self.schedule(weekday=3, start=time(12), end=time(20), valid_from=date(2026, 9, 1))

        data = self.context(starts_at=self.dt(2026, 9, 10, 19, 30), duration=30)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['schedule_start'], '12:00')
        self.assertEqual(data['schedule_end'], '20:00')

    def test_weekday_is_selected_from_local_master_class_date(self):
        self.schedule(weekday=1, start=time(10), end=time(20), valid_from=date(2026, 8, 1))

        data = self.context(starts_at=self.dt(2026, 8, 18, 12), duration=60)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['schedule_start'], '10:00')

    def test_local_timezone_is_used_for_schedule_date(self):
        self.schedule(weekday=3, start=time(1), end=time(3), valid_from=date(2026, 9, 1))
        starts_at = datetime(2026, 9, 9, 20, 30, tzinfo=datetime_timezone.utc)

        data = self.context(starts_at=starts_at, duration=60)

        self.assertEqual(data['status'], 'within_schedule')
        self.assertEqual(data['schedule_start'], '01:00')

    def test_missing_duration_status(self):
        self.schedule(weekday=0)

        data = self.context(duration=None)

        self.assertEqual(data['status'], 'unknown_duration')
        self.assertEqual(data['regular_minutes'], 0)
        self.assertIsNone(data['ends_at'])

    def test_preview_endpoint_matches_serializer_calculation(self):
        self.schedule(weekday=0)
        item = self.create_master_class(starts_at=self.dt(2026, 8, 17, 19, 30), duration=90)

        detail = self.client.get(f'/api/master-classes/{item.id}/')
        preview = self.client.post('/api/master-classes/manager-schedule-preview/', {
            'manager': self.manager.id,
            'starts_at': '2026-08-17T19:30',
            'duration_minutes': 90,
        }, format='json')

        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['status'], detail.data['manager_work_schedule']['status'])
        self.assertEqual(preview.data['regular_minutes'], detail.data['manager_work_schedule']['regular_minutes'])
        self.assertEqual(preview.data['outside_minutes'], detail.data['manager_work_schedule']['outside_minutes'])

    def test_preview_naive_business_time_matches_persisted_utc_time(self):
        self.schedule(weekday=6, start=time(16), end=time(21), valid_from=date(2026, 9, 1))
        persisted = self.create_master_class(
            starts_at=datetime(2026, 9, 13, 11, 59, tzinfo=datetime_timezone.utc),
            duration=60,
        )

        detail = self.client.get(f'/api/master-classes/{persisted.id}/')
        preview = self.client.post('/api/master-classes/manager-schedule-preview/', {
            'manager': self.manager.id,
            'starts_at': '2026-09-13T16:59',
            'duration_minutes': 60,
        }, format='json')
        pay_preview = self.client.post('/api/master-classes/pay-preview/', {
            'starts_at': '2026-09-13T16:59',
            'duration_minutes': 60,
            'staff_assignments': [{'employee': self.manager.id, 'is_extra_work': False}],
        }, format='json')

        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(pay_preview.status_code, 200, pay_preview.data)
        self.assertEqual(preview.data['status'], 'within_schedule')
        self.assertEqual(preview.data['regular_minutes'], 60)
        self.assertEqual(preview.data['outside_minutes'], 0)
        self.assertEqual(pay_preview.data['items'][0]['regular_minutes'], 60)
        self.assertEqual(pay_preview.data['items'][0]['outside_minutes'], 0)
        self.assertFalse(detail.data['outside_regular_hours'])
        self.assertEqual(preview.data['status'], detail.data['manager_work_schedule']['status'])
        self.assertEqual(preview.data['regular_minutes'], detail.data['manager_work_schedule']['regular_minutes'])
        self.assertEqual(preview.data['outside_minutes'], detail.data['manager_work_schedule']['outside_minutes'])

    def test_business_timezone_standard_window_edges(self):
        self.schedule(weekday=6, start=time(16), end=time(21), valid_from=date(2026, 9, 1))

        before = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-09-13T15:59', 'duration_minutes': 60}, format='json')
        inside = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-09-13T16:00', 'duration_minutes': 60}, format='json')
        late = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-09-13T20:30', 'duration_minutes': 60}, format='json')
        at_end = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-09-13T21:00', 'duration_minutes': 60}, format='json')

        self.assertEqual(before.data['status'], 'partial')
        self.assertEqual(before.data['regular_minutes'], 59)
        self.assertEqual(before.data['outside_minutes'], 1)
        self.assertEqual(inside.data['status'], 'within_schedule')
        self.assertEqual(late.data['status'], 'partial')
        self.assertEqual(late.data['regular_minutes'], 30)
        self.assertEqual(late.data['outside_minutes'], 30)
        self.assertEqual(at_end.data['status'], 'outside_schedule')

    def test_preview_changes_when_manager_changes(self):
        self.schedule(employee=self.manager, weekday=0, start=time(10), end=time(20))
        self.schedule(employee=self.other_manager, weekday=0, start=time(8), end=time(9))

        first = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-08-17T10:30', 'duration_minutes': 60}, format='json')
        second = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.other_manager.id, 'starts_at': '2026-08-17T10:30', 'duration_minutes': 60}, format='json')

        self.assertEqual(first.data['status'], 'within_schedule')
        self.assertEqual(second.data['status'], 'outside_schedule')

    def test_preview_changes_when_starts_at_changes(self):
        self.schedule(weekday=0, start=time(10), end=time(20))

        first = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-08-17T14:00', 'duration_minutes': 60}, format='json')
        second = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-08-17T21:00', 'duration_minutes': 60}, format='json')

        self.assertEqual(first.data['status'], 'within_schedule')
        self.assertEqual(second.data['status'], 'outside_schedule')

    def test_preview_changes_when_duration_changes(self):
        self.schedule(weekday=0, start=time(10), end=time(20))

        first = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-08-17T19:30', 'duration_minutes': 30}, format='json')
        second = self.client.post('/api/master-classes/manager-schedule-preview/', {'manager': self.manager.id, 'starts_at': '2026-08-17T19:30', 'duration_minutes': 90}, format='json')

        self.assertEqual(first.data['status'], 'within_schedule')
        self.assertEqual(second.data['status'], 'partial')

    def test_existing_master_classes_need_no_data_migration(self):
        self.schedule(weekday=0)
        item = self.create_master_class(starts_at=self.dt(2026, 8, 17, 14), duration=60)

        response = self.client.get(f'/api/master-classes/{item.id}/')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['manager_work_schedule']['status'], 'within_schedule')
        self.assertFalse(hasattr(item, 'manager_work_schedule'))

    def test_serializer_reuses_schedule_cache_for_same_manager_and_date(self):
        self.schedule(weekday=0)
        items = [self.create_master_class(starts_at=self.dt(2026, 8, 17, 14), duration=60) for _ in range(3)]

        with CaptureQueriesContext(connection) as captured:
            MasterClassSerializer(items, many=True, context={}).data

        schedule_queries = [
            query for query in captured.captured_queries
            if 'crm_employeeworkschedule' in query['sql'].lower()
        ]
        self.assertEqual(len(schedule_queries), 1)
