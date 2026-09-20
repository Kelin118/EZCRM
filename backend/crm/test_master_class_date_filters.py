from datetime import date, datetime
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Branch, FinanceTransaction, MasterClass, MasterClassPayment


class MasterClassDateFilterTests(APITestCase):
    def setUp(self):
        timezone.activate('Asia/Almaty')
        self.admin = get_user_model().objects.create_user(username='date-filter-admin', role='admin', roles=['admin'])
        self.client.force_authenticate(self.admin)
        self.branch = Branch.objects.create(name='Date filter branch')

    def tearDown(self):
        timezone.deactivate()
        super().tearDown()

    def master_class(self, day, hour=12, minute=0):
        starts_at = datetime(2026, 9, day, hour, minute, tzinfo=ZoneInfo('Asia/Almaty'))
        return MasterClass.objects.create(
            title=f'MK {day}', starts_at=starts_at, branch=self.branch,
            stage=MasterClass.Stage.BOOKED, price='18000.00',
        )

    def payment(self, master_class, day, amount='5000.00'):
        transaction = FinanceTransaction.objects.create(
            branch=self.branch, transaction_type=FinanceTransaction.Type.INCOME,
            amount=amount, subtotal_amount=amount, source='master_class',
        )
        return MasterClassPayment.objects.create(
            master_class=master_class, amount=amount, payment_date=date(2026, 9, day),
            finance_transaction=transaction, accepted_by=self.admin,
        )

    def ids(self, **params):
        response = self.client.get('/api/master-classes/', params)
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data if isinstance(response.data, list) else response.data['results']
        return {item['id'] for item in data}

    def test_event_range_is_inclusive_and_supports_single_boundaries(self):
        items = {day: self.master_class(day) for day in (1, 5, 15, 16, 25, 30)}
        self.assertEqual(
            self.ids(event_date_from='2026-09-01', event_date_to='2026-09-15'),
            {items[1].pk, items[5].pk, items[15].pk},
        )
        self.assertEqual(
            self.ids(event_date_from='2026-09-15'),
            {items[15].pk, items[16].pk, items[25].pk, items[30].pk},
        )
        self.assertEqual(
            self.ids(event_date_to='2026-09-15'),
            {items[1].pk, items[5].pk, items[15].pk},
        )

    def test_late_almaty_time_is_included_in_local_end_date(self):
        late = self.master_class(15, 23, 30)
        next_day = self.master_class(16, 0, 30)
        result = self.ids(event_date_from='2026-09-15', event_date_to='2026-09-15')
        self.assertIn(late.pk, result)
        self.assertNotIn(next_day.pk, result)

    def test_payment_range_matches_any_single_payment_row(self):
        master_class = self.master_class(10)
        self.payment(master_class, 5)
        self.payment(master_class, 20, amount='13000.00')
        MasterClass.objects.filter(pk=master_class.pk).update(payment_date=date(2026, 9, 20))
        self.assertEqual(self.ids(payment_date_from='2026-09-01', payment_date_to='2026-09-15'), {master_class.pk})
        self.assertEqual(self.ids(payment_date_from='2026-09-06', payment_date_to='2026-09-15'), set())
        self.assertEqual(self.ids(payment_date_from='2026-09-16', payment_date_to='2026-09-30'), {master_class.pk})

    def test_event_and_payment_ranges_are_independent_and_composable(self):
        early_event = self.master_class(10)
        self.payment(early_event, 7)
        late_event = self.master_class(25)
        self.payment(late_event, 5)
        self.assertEqual(self.ids(event_date_from='2026-09-01', event_date_to='2026-09-15'), {early_event.pk})
        self.assertEqual(self.ids(payment_date_from='2026-09-01', payment_date_to='2026-09-15'), {early_event.pk, late_event.pk})
        self.assertEqual(self.ids(
            event_date_from='2026-09-01', event_date_to='2026-09-15',
            payment_date_from='2026-09-05', payment_date_to='2026-09-10',
        ), {early_event.pk})

    def test_legacy_payment_date_is_used_only_without_payment_rows(self):
        legacy = self.master_class(10)
        transaction = FinanceTransaction.objects.create(
            branch=self.branch, transaction_type=FinanceTransaction.Type.INCOME,
            amount='5000.00', subtotal_amount='5000.00', source='master_class',
        )
        legacy.payment_amount = '5000.00'
        legacy.payment_date = date(2026, 9, 5)
        legacy.finance_transaction = transaction
        legacy.save(update_fields=('payment_amount', 'payment_date', 'finance_transaction', 'updated_at'))
        modern = self.master_class(10)
        self.payment(modern, 20)
        MasterClass.objects.filter(pk=modern.pk).update(payment_date=date(2026, 9, 5))
        self.assertEqual(self.ids(payment_date_from='2026-09-01', payment_date_to='2026-09-15'), {legacy.pk})

    def test_invalid_ranges_return_400(self):
        event = self.client.get('/api/master-classes/', {
            'event_date_from': '2026-09-15', 'event_date_to': '2026-09-01',
        })
        payment = self.client.get('/api/master-classes/', {
            'payment_date_from': '2026-09-15', 'payment_date_to': '2026-09-01',
        })
        self.assertEqual(event.status_code, 400)
        self.assertEqual(payment.status_code, 400)
