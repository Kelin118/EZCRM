from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from crm.models import AuditLog, Branch, CertificateTemplate, Client, FinanceTransaction, GiftCertificate, PaymentMethod


class CertificateBranchTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(username='certificate-branch-admin', password='pass')
        self.client.force_authenticate(self.admin)
        self.first_branch = Branch.objects.create(name='Первый филиал')
        self.second_branch = Branch.objects.create(name='Второй филиал')
        self.buyer = Client.objects.create(first_name='Покупатель', phone='87070000001', branch=self.first_branch)
        self.method = PaymentMethod.objects.create(name='Наличные для сертификата', code='cert_branch_cash', is_cash=True)
        self.template = CertificateTemplate.objects.create(
            name='Подарочный', amount_type=CertificateTemplate.AmountType.FIXED,
            fixed_amount=Decimal('10000.00'), validity_days=365,
        )

    def single_payload(self, **overrides):
        payload = {
            'template': self.template.pk,
            'purchaser_client': self.buyer.pk,
            'recipient_name': 'Получатель',
            'face_value': '10000.00',
            'payment_parts': [{'payment_method': self.method.pk, 'amount': '10000.00'}],
        }
        payload.update(overrides)
        return payload

    def test_selected_branch_overrides_buyer_branch_for_single_sale(self):
        response = self.client.post('/api/certificates/', self.single_payload(branch=self.second_branch.pk), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        certificate = GiftCertificate.objects.get(pk=response.data['id'])
        self.assertEqual(certificate.finance_transaction.branch_id, self.second_branch.pk)
        self.assertEqual(certificate.batch.finance_transaction.branch_id, self.second_branch.pk)
        self.assertEqual(certificate.purchaser_client.branch_id, self.first_branch.pk)

    def test_manual_buyer_batch_uses_selected_branch(self):
        response = self.client.post('/api/certificates/bulk-create/', {
            'template': self.template.pk,
            'purchaser_name': 'Покупатель без карточки',
            'purchaser_phone': '87070000002',
            'branch': self.second_branch.pk,
            'quantity': 2,
            'face_value': '10000.00',
            'payment_parts': [{'payment_method': self.method.pk, 'amount': '20000.00'}],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(FinanceTransaction.objects.get(pk=response.data['batch']['finance_transaction']).branch_id,
                         self.second_branch.pk)

    def test_explicit_invalid_branch_rejects_sale_without_records(self):
        response = self.client.post('/api/certificates/', self.single_payload(branch=999999), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('branch', response.data)
        self.assertFalse(GiftCertificate.objects.exists())

    def test_finance_can_correct_certificate_branch_but_not_amount(self):
        self.buyer.branch = None
        self.buyer.save(update_fields=('branch',))
        created = self.client.post('/api/certificates/', self.single_payload(), format='json')
        self.assertEqual(created.status_code, 201, created.data)
        certificate = GiftCertificate.objects.get(pk=created.data['id'])
        finance_id = certificate.finance_transaction_id
        self.assertIsNone(certificate.finance_transaction.branch_id)

        response = self.client.patch(f'/api/finance/{finance_id}/', {'branch': self.second_branch.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        finance = FinanceTransaction.objects.get(pk=finance_id)
        self.assertEqual(finance.branch_id, self.second_branch.pk)
        self.assertEqual(finance.amount, Decimal('10000.00'))
        self.assertEqual(finance.payment_parts.count(), 1)
        self.assertTrue(AuditLog.objects.filter(entity_type='FinanceTransaction', entity_id=str(finance_id),
                                                changes__branch=self.second_branch.pk).exists())

        rejected = self.client.patch(f'/api/finance/{finance_id}/', {'amount': '1.00'}, format='json')
        self.assertEqual(rejected.status_code, 400)
        finance.refresh_from_db()
        self.assertEqual(finance.amount, Decimal('10000.00'))
