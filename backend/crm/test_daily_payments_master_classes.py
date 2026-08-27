from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Branch, Client, FinancePaymentPart, FinanceTransaction, MasterClass, PaymentMethod


def aware_dt(year, month, day, hour=0, minute=0):
    return timezone.make_aware(datetime(year, month, day, hour, minute))


def response_items(response):
    return response.data if isinstance(response.data, list) else response.data.get('results', [])


class DailyPaymentsReportTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='daily-admin', password='pass', role='admin', roles=['admin'])
        self.manager = User.objects.create_user(username='daily-manager', password='pass', role='manager', roles=['manager'])
        self.accountant = User.objects.create_user(username='daily-accountant', password='pass', role='accountant', roles=['accountant'])
        self.teacher = User.objects.create_user(username='daily-teacher', password='pass', role='teacher', roles=['teacher'])
        self.branch = Branch.objects.create(name='Абая')
        self.other_branch = Branch.objects.create(name='Сарыарка')
        self.cash = PaymentMethod.objects.create(name='Daily Report Cash', code='daily_report_cash', is_cash=True)
        self.card = PaymentMethod.objects.create(name='Daily Report Kaspi QR', code='daily_report_kaspi', is_cash=False)
        self.date = '2026-08-18'

    def transaction(self, amount, method=None, *, branch=None, paid_at=None, transaction_type=FinanceTransaction.Type.INCOME, parts=None):
        transaction = FinanceTransaction.objects.create(
            transaction_type=transaction_type,
            amount=Decimal(amount),
            source='manual',
            branch=branch,
            payment_method=method,
            payment_method_name=method.name if method else '',
            paid_at=paid_at or aware_dt(2026, 8, 18, 12),
        )
        for payment_method, part_amount in parts or []:
            FinancePaymentPart.objects.create(
                transaction=transaction,
                payment_method=payment_method,
                payment_method_name=payment_method.name,
                amount=Decimal(part_amount),
            )
        return transaction

    def report(self, user=None, params=None):
        self.client.force_authenticate(user or self.accountant)
        response = self.client.get('/api/reports/daily-payments/', {'date': self.date, **(params or {})})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def branch_row(self, data, branch_name='Абая'):
        return next(item for item in data['branches'] if item['branch_name'] == branch_name)

    def test_cash_income_goes_to_cash_income(self):
        self.transaction('4000.00', self.cash, branch=self.branch)

        data = self.report()

        self.assertEqual(Decimal(self.branch_row(data)['cash_income']), Decimal('4000.00'))

    def test_non_cash_income_goes_to_card_income(self):
        self.transaction('6000.00', self.card, branch=self.branch)

        data = self.report()

        self.assertEqual(Decimal(self.branch_row(data)['card_income']), Decimal('6000.00'))

    def test_mixed_payment_is_split_by_parts(self):
        self.transaction('10000.00', branch=self.branch, parts=[(self.cash, '4000.00'), (self.card, '6000.00')])

        row = self.branch_row(self.report())

        self.assertEqual(Decimal(row['cash_income']), Decimal('4000.00'))
        self.assertEqual(Decimal(row['card_income']), Decimal('6000.00'))

    def test_mixed_payment_does_not_double_transaction_amount(self):
        self.transaction('10000.00', branch=self.branch, parts=[(self.cash, '4000.00'), (self.card, '6000.00')])

        row = self.branch_row(self.report())

        self.assertEqual(Decimal(row['total_income']), Decimal('10000.00'))
        self.assertEqual(Decimal(self.report()['totals']['income_total']), Decimal('10000.00'))

    def test_legacy_cash_payment_method_works(self):
        self.transaction('3000.00', self.cash, branch=self.branch)

        self.assertEqual(Decimal(self.branch_row(self.report())['cash_income']), Decimal('3000.00'))

    def test_legacy_non_cash_payment_method_works(self):
        self.transaction('3000.00', self.card, branch=self.branch)

        self.assertEqual(Decimal(self.branch_row(self.report())['card_income']), Decimal('3000.00'))

    def test_income_without_payment_method_goes_to_unassigned(self):
        self.transaction('2500.00', None, branch=self.branch)

        self.assertEqual(Decimal(self.branch_row(self.report())['unassigned_income']), Decimal('2500.00'))

    def test_total_income_includes_unassigned(self):
        self.transaction('2500.00', None, branch=self.branch)
        self.transaction('7500.00', self.card, branch=self.branch)

        self.assertEqual(Decimal(self.branch_row(self.report())['total_income']), Decimal('10000.00'))

    def test_branches_are_calculated_separately(self):
        self.transaction('1000.00', self.cash, branch=self.branch)
        self.transaction('3000.00', self.cash, branch=self.other_branch)

        data = self.report()

        self.assertEqual(Decimal(self.branch_row(data, 'Абая')['cash_income']), Decimal('1000.00'))
        self.assertEqual(Decimal(self.branch_row(data, 'Сарыарка')['cash_income']), Decimal('3000.00'))

    def test_branch_filter_returns_only_selected_branch(self):
        self.transaction('1000.00', self.cash, branch=self.branch)
        self.transaction('3000.00', self.cash, branch=self.other_branch)

        data = self.report(params={'branch': self.branch.id})

        self.assertEqual(len(data['branches']), 1)
        self.assertEqual(data['branches'][0]['branch_name'], 'Абая')

    def test_unassigned_branch_is_reported(self):
        self.transaction('1200.00', self.cash, branch=None)

        data = self.report()

        self.assertEqual(data['branches'][0]['branch_name'], 'Не распределено')

    def test_expense_total_is_counted(self):
        self.transaction('10000.00', self.cash, branch=self.branch)
        self.transaction('3500.00', self.cash, branch=self.branch, transaction_type=FinanceTransaction.Type.EXPENSE)

        row = self.branch_row(self.report())

        self.assertEqual(Decimal(row['expense_total']), Decimal('3500.00'))

    def test_net_total_is_income_minus_expense(self):
        self.transaction('10000.00', self.cash, branch=self.branch)
        self.transaction('3500.00', self.cash, branch=self.branch, transaction_type=FinanceTransaction.Type.EXPENSE)

        data = self.report()

        self.assertEqual(Decimal(data['totals']['net_total']), Decimal('6500.00'))

    def test_other_day_is_not_included(self):
        self.transaction('10000.00', self.cash, branch=self.branch, paid_at=aware_dt(2026, 8, 17, 12))

        data = self.report()

        self.assertEqual(Decimal(data['totals']['income_total']), Decimal('0.00'))

    def test_teacher_cannot_access_daily_payments(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.get('/api/reports/daily-payments/', {'date': self.date})

        self.assertEqual(response.status_code, 403)

    def test_admin_manager_and_accountant_can_access_daily_payments(self):
        for user in (self.admin, self.manager, self.accountant):
            with self.subTest(role=user.role):
                self.client.force_authenticate(user)
                response = self.client.get('/api/reports/daily-payments/', {'date': self.date})
                self.assertEqual(response.status_code, 200)


@override_settings(TIME_ZONE='Asia/Qyzylorda')
class MasterClassFiltersAndDuplicateTests(APITestCase):
    def setUp(self):
        timezone.activate('Asia/Qyzylorda')
        User = get_user_model()
        self.manager = User.objects.create_user(username='mc-manager', password='pass', role='manager', roles=['manager'])
        self.teacher = User.objects.create_user(username='mc-teacher', password='pass', role='teacher', roles=['teacher'])
        self.other_teacher = User.objects.create_user(username='mc-teacher-2', password='pass', role='teacher', roles=['teacher'])
        self.branch = Branch.objects.create(name='МК Абая')
        self.other_branch = Branch.objects.create(name='МК Сарыарка')
        self.cash = PaymentMethod.objects.create(name='МК Cash', code='mc_cash')
        self.client_obj = Client.objects.create(first_name='Алина', last_name='Алимова', parent_name='Айжан', phone='87071234567', branch=self.branch)
        self.other_client = Client.objects.create(first_name='Диана', last_name='Садыкова', branch=self.branch)

    def tearDown(self):
        timezone.deactivate()
        super().tearDown()

    def create_master_class(self, *, client=None, title='Рисование', starts_at=None, teacher=None, branch=None, payment_date=None, is_extra_work=False, payment_amount=Decimal('0.00'), payment_method=None):
        master_class = MasterClass.objects.create(
            title=title,
            starts_at=starts_at or aware_dt(2026, 8, 17, 16),
            manager=self.manager,
            teacher=teacher or self.teacher,
            branch=branch or self.branch,
            payment_date=payment_date,
            price=Decimal('10000.00'),
            payment_amount=payment_amount,
            is_extra_work=is_extra_work,
        )
        if client is not None:
            master_class.participants.add(client)
        if payment_amount > 0 and payment_method:
            transaction = FinanceTransaction.objects.create(
                transaction_type=FinanceTransaction.Type.INCOME,
                amount=payment_amount,
                source='master_class',
                client=client,
                branch=branch or self.branch,
                manager=self.manager,
                payment_method=payment_method,
                payment_method_name=payment_method.name,
                paid_at=aware_dt(2026, 8, 17, 12),
            )
            master_class.finance_transaction = transaction
            master_class.save(update_fields=['finance_transaction'])
        return master_class

    def list_master_classes(self, params):
        self.client.force_authenticate(self.manager)
        response = self.client.get('/api/master-classes/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response_items(response)

    def test_event_date_returns_only_selected_starts_at_day(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 16))
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 18, 16))

        items = self.list_master_classes({'event_date': '2026-08-17'})

        self.assertEqual([item['id'] for item in items], [first.id])

    def test_event_date_does_not_use_payment_date(self):
        self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 16), payment_date='2026-08-18')

        items = self.list_master_classes({'event_date': '2026-08-18'})

        self.assertEqual(items, [])

    def test_event_date_from_works(self):
        self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 16, 16))
        second = self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 17, 16))

        items = self.list_master_classes({'event_date_from': '2026-08-17'})

        self.assertEqual([item['id'] for item in items], [second.id])

    def test_event_date_to_works(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 16, 16))
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 17, 16))

        items = self.list_master_classes({'event_date_to': '2026-08-16'})

        self.assertEqual([item['id'] for item in items], [first.id])

    def test_branch_and_event_date_work_together(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 16), branch=self.branch)
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 17, 17), branch=self.other_branch)

        items = self.list_master_classes({'event_date': '2026-08-17', 'branch': self.branch.id})

        self.assertEqual([item['id'] for item in items], [first.id])

    def assert_outside_ids(self, expected_ids, **params):
        items = self.list_master_classes({'outside_regular_hours': 'true', **params})
        self.assertEqual({item['id'] for item in items}, set(expected_ids))
        return items

    def test_1559_is_outside(self):
        item = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 15, 59))

        self.assert_outside_ids([item.id])

    def test_1600_is_not_outside(self):
        self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 16, 0))

        self.assert_outside_ids([])

    def test_2059_is_not_outside(self):
        self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 20, 59))

        self.assert_outside_ids([])

    def test_2100_is_outside(self):
        item = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 21, 0))

        self.assert_outside_ids([item.id])

    def test_2200_is_outside(self):
        item = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 22, 0))

        self.assert_outside_ids([item.id])

    def test_timezone_is_used_for_outside_hours(self):
        utc_dt = datetime(2026, 8, 17, 15, 30, tzinfo=datetime_timezone.utc)
        self.create_master_class(client=self.client_obj, starts_at=utc_dt)

        self.assert_outside_ids([])

    def test_extra_work_defaults_false_and_returns_separate_time_flags(self):
        item = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 15, 0))

        data = self.list_master_classes({'event_date': '2026-08-17'})[0]

        self.assertEqual(data['id'], item.id)
        self.assertFalse(data['is_extra_work'])
        self.assertTrue(data['time_outside_regular_hours'])
        self.assertTrue(data['outside_regular_hours'])

    def test_extra_work_filter_uses_manual_flag_not_time(self):
        marked_inside = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 18), is_extra_work=True)
        self.create_master_class(client=self.client_obj, title='Ранний МК', starts_at=aware_dt(2026, 8, 17, 15), is_extra_work=False)

        items = self.list_master_classes({'extra_work': 'true'})

        self.assertEqual([item['id'] for item in items], [marked_inside.id])
        self.assertFalse(items[0]['time_outside_regular_hours'])
        self.assertTrue(items[0]['is_extra_work'])

    def test_physical_outside_filter_stays_independent_from_extra_work(self):
        self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 18), is_extra_work=True)
        outside = self.create_master_class(client=self.client_obj, title='Ранний МК', starts_at=aware_dt(2026, 8, 17, 15), is_extra_work=False)

        items = self.list_master_classes({'outside_regular_hours': 'true'})

        self.assertEqual([item['id'] for item in items], [outside.id])
        self.assertFalse(items[0]['is_extra_work'])

    def test_finance_extra_master_class_filter_uses_manual_flag(self):
        marked = self.create_master_class(
            client=self.client_obj,
            starts_at=aware_dt(2026, 8, 17, 18),
            is_extra_work=True,
            payment_amount=Decimal('5000.00'),
            payment_method=self.cash,
        )
        self.create_master_class(
            client=self.client_obj,
            title='Ранний МК',
            starts_at=aware_dt(2026, 8, 17, 15),
            is_extra_work=False,
            payment_amount=Decimal('5000.00'),
            payment_method=self.cash,
        )
        self.client.force_authenticate(self.manager)

        response = self.client.get('/api/finance/', {'extra_master_class': 'true', 'teacher': self.teacher.id})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['master_class_id'], marked.id)
        self.assertTrue(response.data[0]['master_class_is_extra_work'])
        self.assertFalse(response.data[0]['master_class_time_outside_regular_hours'])

    def test_outside_with_date_range_works(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 15))
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 18, 15))

        self.assert_outside_ids([first.id], event_date_from='2026-08-17', event_date_to='2026-08-17')

    def test_outside_with_teacher_works(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 15), teacher=self.teacher)
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 17, 15), teacher=self.other_teacher)

        self.assert_outside_ids([first.id], teacher=self.teacher.id)

    def test_outside_with_branch_works(self):
        first = self.create_master_class(client=self.client_obj, starts_at=aware_dt(2026, 8, 17, 15), branch=self.branch)
        self.create_master_class(client=self.client_obj, title='Лепка', starts_at=aware_dt(2026, 8, 17, 15), branch=self.other_branch)

        self.assert_outside_ids([first.id], branch=self.branch.id)

    def post_master_class(self, title='Рисование', client=None, starts_at='2026-08-17T16:00', is_extra_work=False):
        self.client.force_authenticate(self.manager)
        return self.client.post(
            '/api/master-classes/',
            {
                'title': title,
                'client': (client or self.client_obj).id,
                'starts_at': starts_at,
                'manager': self.manager.id,
                'teacher': self.teacher.id,
                'branch': self.branch.id,
                'is_extra_work': is_extra_work,
            },
            format='json',
        )

    def test_create_and_update_extra_work_flag(self):
        response = self.post_master_class(is_extra_work=True)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['is_extra_work'])

        patch = self.client.patch(f"/api/master-classes/{response.data['id']}/", {'is_extra_work': False}, format='json')
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertFalse(patch.data['is_extra_work'])

    def test_same_client_same_date_same_title_is_rejected(self):
        first = self.post_master_class()
        second = self.post_master_class(starts_at='2026-08-17T18:00')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(MasterClass.objects.count(), 1)

    def test_title_duplicate_is_case_insensitive(self):
        self.post_master_class(title='Рисование')

        response = self.post_master_class(title='рисование')

        self.assertEqual(response.status_code, 400)

    def test_extra_spaces_do_not_bypass_duplicate_check(self):
        self.post_master_class(title='Рисование акварелью')

        response = self.post_master_class(title='  рисование   акварелью  ')

        self.assertEqual(response.status_code, 400)

    def test_extra_work_does_not_bypass_duplicate_check(self):
        self.post_master_class(is_extra_work=False)

        response = self.post_master_class(is_extra_work=True)

        self.assertEqual(response.status_code, 400)

    def test_same_client_other_date_is_allowed(self):
        self.post_master_class(starts_at='2026-08-17T16:00')

        response = self.post_master_class(starts_at='2026-08-18T16:00')

        self.assertEqual(response.status_code, 201, response.data)

    def test_same_client_other_title_is_allowed(self):
        self.post_master_class(title='Рисование')

        response = self.post_master_class(title='Лепка')

        self.assertEqual(response.status_code, 201, response.data)

    def test_other_client_same_date_and_title_is_allowed(self):
        self.post_master_class(client=self.client_obj)

        response = self.post_master_class(client=self.other_client)

        self.assertEqual(response.status_code, 201, response.data)

    def test_editing_same_record_is_not_duplicate(self):
        create = self.post_master_class()
        self.client.force_authenticate(self.manager)

        response = self.client.patch(f"/api/master-classes/{create.data['id']}/", {'title': 'Рисование'}, format='json')

        self.assertEqual(response.status_code, 200, response.data)

    def test_update_to_existing_combination_is_blocked(self):
        first = self.post_master_class(title='Рисование')
        second = self.post_master_class(title='Лепка')
        self.client.force_authenticate(self.manager)

        response = self.client.patch(f"/api/master-classes/{second.data['id']}/", {'title': 'рисование'}, format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(response.status_code, 400)

    def test_duplicate_response_contains_duplicate_id(self):
        first = self.post_master_class()

        response = self.post_master_class(starts_at='2026-08-17T18:00')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(str(response.data['duplicate']['id']), str(first.data['id']))

    def test_repeated_create_does_not_create_two_duplicates(self):
        responses = [self.post_master_class(), self.post_master_class(), self.post_master_class()]

        self.assertEqual([response.status_code for response in responses], [201, 400, 400])
        self.assertEqual(MasterClass.objects.count(), 1)

    def test_clients_options_contains_branch_fields(self):
        self.client.force_authenticate(self.manager)

        response = self.client.get('/api/clients/options/')

        item = next(item for item in response.data if item['id'] == self.client_obj.id)
        self.assertEqual(item['branch'], self.branch.id)
        self.assertEqual(item['branch_name'], self.branch.name)
