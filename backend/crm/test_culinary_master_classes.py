from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import FinanceTransaction, MasterClass, MasterClassPayment, MasterClassSubject


class CulinaryMasterClassFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(get_user_model().objects.create_user(
            username='culinary-filter-admin', password='pass', role='admin', roles=['admin'],
        ))
        self.cooking = MasterClassSubject.objects.create(name='Пицца', is_culinary=True)
        self.baking = MasterClassSubject.objects.create(name='Выпечка', is_culinary=True, is_active=False)
        self.other = MasterClassSubject.objects.create(name='Рисование')

        def add(subject, day):
            return MasterClass.objects.create(
                subject=subject, title=subject.name, starts_at=datetime(2026, 10 if day < 32 else 11, day if day < 32 else 1, tzinfo=ZoneInfo('Asia/Almaty')),
            )

        self.october_cooking = add(self.cooking, 3)
        self.october_baking = add(self.baking, 20)
        self.november_cooking = add(self.cooking, 32)
        self.october_other = add(self.other, 4)

    def test_culinary_includes_all_marked_subjects_in_month_even_if_inactive(self):
        for master_class, amount in (
            (self.october_cooking, Decimal('1000.50')),
            (self.october_baking, Decimal('2500.00')),
        ):
            transaction = FinanceTransaction.objects.create(
                transaction_type='income', amount=amount, source='master_class',
            )
            MasterClassPayment.objects.create(
                master_class=master_class, amount=amount, payment_date=date(2026, 11, 1),
                finance_transaction=transaction,
            )
        response = self.client.get('/api/master-classes/', {
            'subject': 'culinary', 'event_date_from': '2026-10-01', 'event_date_to': '2026-10-31',
        })
        self.assertEqual(response.status_code, 200, response.data)
        items = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual({item['id'] for item in items}, {self.october_cooking.id, self.october_baking.id})
        self.assertEqual(sum((Decimal(str(item['paid_total'])) for item in items), Decimal('0.00')), Decimal('3500.50'))

        self.other.is_culinary = True
        self.other.save(update_fields=['is_culinary'])
        response = self.client.get('/api/master-classes/', {
            'subject': 'culinary', 'event_date_from': '2026-10-01', 'event_date_to': '2026-10-31',
        })
        items = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual({item['id'] for item in items}, {
            self.october_cooking.id, self.october_baking.id, self.october_other.id,
        })
