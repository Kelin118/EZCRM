from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Branch, Client, FinanceTransaction, MasterClass, MasterClassPayment, MasterClassSubject, PaymentMethod


class MasterClassPurchaseTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin = user_model.objects.create_user(username='purchase-admin', password='pass', role='admin', roles=['admin'])
        self.manager = user_model.objects.create_user(username='purchase-manager', password='pass', role='manager', roles=['manager'])
        self.branch = Branch.objects.create(name='Purchase branch')
        self.client_record = Client.objects.create(first_name='Purchase', branch=self.branch)
        self.other_client = Client.objects.create(first_name='Other', branch=self.branch)
        self.first_subject = MasterClassSubject.objects.create(name='Purchase Art')
        self.second_subject = MasterClassSubject.objects.create(name='Purchase Design')
        self.method = PaymentMethod.objects.create(name='Purchase cash', code='purchase_cash')
        self.client.force_authenticate(self.admin)

    def create_master_class(self, subject, client=None, branch=None):
        item = MasterClass.objects.create(
            subject=subject, title=subject.name, starts_at=timezone.now(),
            branch=branch or self.branch, price=Decimal('6000.00'),
        )
        item.participants.add(client or self.client_record)
        return item

    def test_bulk_create_links_purchase_without_combining_payments(self):
        start = timezone.now()
        response = self.client.post('/api/master-classes/bulk-create/', {
            'client': self.client_record.id,
            'branch': self.branch.id,
            'items': [
                {
                    'subject': self.first_subject.id, 'starts_at': start.isoformat(), 'price': '6000.00',
                    'initial_payment': {'amount': '6000.00', 'payment_parts': [{'payment_method': self.method.id, 'amount': '6000.00'}]},
                },
                {
                    'subject': self.second_subject.id, 'starts_at': (start + timedelta(hours=1)).isoformat(), 'price': '12000.00',
                    'initial_payment': {'amount': '12000.00', 'payment_parts': [{'payment_method': self.method.id, 'amount': '12000.00'}]},
                },
            ],
        }, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        group_id = response.data[0]['purchase_group']
        self.assertTrue(group_id)
        self.assertEqual(response.data[1]['purchase_group'], group_id)
        self.assertEqual([item['payment_status'] for item in response.data], ['paid', 'paid'])
        self.assertEqual(MasterClassPayment.objects.count(), 2)
        self.assertEqual(sum(FinanceTransaction.objects.values_list('amount', flat=True), Decimal('0.00')), Decimal('18000.00'))

        listing = self.client.get('/api/master-classes/', {'purchase_group': group_id})
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.data.get('results', listing.data) if isinstance(listing.data, dict) else listing.data), 2)

    def test_legacy_grouping_preserves_finance_and_can_be_undone(self):
        first = self.create_master_class(self.first_subject)
        second = self.create_master_class(self.second_subject)
        payment = self.client.post(f'/api/master-classes/{first.id}/payments/', {
            'amount': '6000.00', 'payment_parts': [{'payment_method': self.method.id, 'amount': '6000.00'}],
        }, format='json')
        self.assertEqual(payment.status_code, 201, payment.data)
        finance_ids = list(FinanceTransaction.objects.values_list('id', flat=True))

        grouped = self.client.post('/api/master-classes/group-existing/', {'ids': [first.id, second.id]}, format='json')
        self.assertEqual(grouped.status_code, 200, grouped.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.purchase_group, second.purchase_group)
        self.assertEqual(list(FinanceTransaction.objects.values_list('id', flat=True)), finance_ids)
        self.assertEqual(MasterClassPayment.objects.count(), 1)

        ungrouped = self.client.post('/api/master-classes/ungroup-existing/', {
            'purchase_group': grouped.data['purchase_group'],
        }, format='json')
        self.assertEqual(ungrouped.status_code, 200, ungrouped.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.purchase_group)
        self.assertIsNone(second.purchase_group)
        self.assertEqual(list(FinanceTransaction.objects.values_list('id', flat=True)), finance_ids)

    def test_grouping_requires_admin_and_same_client(self):
        first = self.create_master_class(self.first_subject)
        second = self.create_master_class(self.second_subject, client=self.other_client)
        invalid = self.client.post('/api/master-classes/group-existing/', {'ids': [first.id, second.id]}, format='json')
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(MasterClass.objects.exclude(purchase_group__isnull=True).exists())

        second.participants.clear()
        second.participants.add(self.client_record)
        self.client.force_authenticate(self.manager)
        forbidden = self.client.post('/api/master-classes/group-existing/', {'ids': [first.id, second.id]}, format='json')
        self.assertEqual(forbidden.status_code, 403)
        self.assertFalse(MasterClass.objects.exclude(purchase_group__isnull=True).exists())
