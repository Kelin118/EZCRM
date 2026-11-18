from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import FinanceTransaction, MasterClass, MasterClassPayment, MasterClassSubject, MasterClassSubjectGroup


class MasterClassSubjectGroupTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(username='mc-group-admin', password='pass', role='admin', roles=['admin'])
        self.manager = get_user_model().objects.create_user(username='mc-group-manager', password='pass', role='manager', roles=['manager'])
        self.accountant = get_user_model().objects.create_user(username='mc-group-accountant', password='pass', role='accountant', roles=['accountant'])
        self.first = MasterClassSubject.objects.create(name='Живопись')
        self.second = MasterClassSubject.objects.create(name='Гончарное дело', is_active=False)
        self.other = MasterClassSubject.objects.create(name='Музыка')

    def test_manager_can_manage_group_and_filter_past_month(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/master-class-subject-groups/', {
            'name': 'Творчество', 'subjects': [self.first.id, self.second.id], 'is_active': True,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        group_id = response.data['id']
        self.assertEqual(set(response.data['subject_names']), {'Живопись', 'Гончарное дело'})

        def add(subject, month, amount):
            master_class = MasterClass.objects.create(
                subject=subject, title=subject.name,
                starts_at=datetime(2026, month, 5, tzinfo=ZoneInfo('Asia/Almaty')),
            )
            transaction = FinanceTransaction.objects.create(transaction_type='income', amount=amount, source='master_class')
            MasterClassPayment.objects.create(
                master_class=master_class, amount=amount, payment_date=date(2026, month, 5), finance_transaction=transaction,
            )
            return master_class

        first_master_class = add(self.first, 10, Decimal('1000.00'))
        second_master_class = add(self.second, 10, Decimal('2500.50'))
        expected = {first_master_class.id, second_master_class.id}
        add(self.other, 10, Decimal('900.00'))
        add(self.first, 11, Decimal('800.00'))
        query = {'subject': f'group:{group_id}', 'event_date_from': '2026-10-01', 'event_date_to': '2026-10-31'}
        response = self.client.get('/api/master-classes/', query)
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual({row['id'] for row in rows}, expected)
        self.assertEqual(sum((Decimal(str(row['paid_total'])) for row in rows), Decimal('0.00')), Decimal('3500.50'))

        response = self.client.patch(f'/api/master-class-subject-groups/{group_id}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(self.client.get('/api/master-classes/', query).data), 2)
        response = self.client.patch(f'/api/master-class-subject-groups/{group_id}/', {'subjects': [self.second.id]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row['id'] for row in self.client.get('/api/master-classes/', query).data], [second_master_class.id])

    def test_validation_and_permissions(self):
        self.client.force_authenticate(self.manager)
        for name in (' ', 'Кулинария'):
            response = self.client.post('/api/master-class-subject-groups/', {'name': name}, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post('/api/master-class-subject-groups/', {'name': 'Творчество', 'subjects': [self.first.id]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        group_id = response.data['id']
        self.assertEqual(self.client.post('/api/master-class-subject-groups/', {'name': ' творчество '}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(f'/api/master-class-subject-groups/{group_id}/').status_code, 403)
        self.client.force_authenticate(self.accountant)
        self.assertEqual(self.client.get('/api/master-class-subject-groups/').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/master-class-subject-groups/{group_id}/', {'name': 'Другое'}, format='json').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f'/api/master-class-subject-groups/{group_id}/').status_code, 409)
        self.assertEqual(self.client.get('/api/master-classes/', {'subject': 'group:bad'}).status_code, 400)
        self.assertTrue(MasterClassSubjectGroup.objects.filter(pk=group_id).exists())
