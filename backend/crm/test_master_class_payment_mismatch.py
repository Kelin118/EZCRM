from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from .models import (
    Branch,
    FinancePaymentPart,
    FinanceTransaction,
    MasterClass,
    MasterClassPayment,
    PaymentMethod,
)


class MasterClassPaymentMismatchTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username='mismatch-admin', role='admin', roles=['admin'])
        self.client.force_authenticate(self.admin)
        self.branch = Branch.objects.create(name='Mismatch branch')
        self.cash = PaymentMethod.objects.create(name='Mismatch cash', code='mismatch-cash')

    def master_class(self, *, price='18000.00', discount_amount='0.00', stage=MasterClass.Stage.BOOKED):
        return MasterClass.objects.create(
            title='Диагностика оплаты', starts_at='2026-09-20T10:00:00Z', branch=self.branch,
            price=price, discount_amount=discount_amount, stage=stage,
        )

    def payment(self, master_class, *, payment_amount, transaction_amount=None, parts_total=None):
        transaction_amount = transaction_amount or payment_amount
        transaction = FinanceTransaction.objects.create(
            branch=self.branch, transaction_type=FinanceTransaction.Type.INCOME,
            amount=transaction_amount, subtotal_amount=transaction_amount, source='master_class',
        )
        if parts_total is not None:
            FinancePaymentPart.objects.create(
                transaction=transaction, payment_method=self.cash,
                payment_method_name=self.cash.name, amount=parts_total,
            )
        return MasterClassPayment.objects.create(
            master_class=master_class, amount=payment_amount, payment_date=date(2026, 9, 20),
            finance_transaction=transaction, accepted_by=self.admin,
        )

    def detail(self, master_class):
        response = self.client.get(f'/api/master-classes/{master_class.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_real_underpayment_is_visible_warning(self):
        master_class = self.master_class()
        self.payment(master_class, payment_amount='16800.00', parts_total='16800.00')
        data = self.detail(master_class)
        self.assertEqual(data['amount_due'], '18000.00')
        self.assertEqual(data['paid_total'], '16800.00')
        self.assertEqual(data['remaining_amount'], '1200.00')
        self.assertEqual(data['payment_difference'], '-1200.00')
        self.assertTrue(data['has_payment_mismatch'])
        self.assertEqual(data['payment_mismatch_type'], 'underpaid')
        self.assertEqual(data['payment_mismatch_amount'], '1200.00')
        self.assertEqual(data['payment_attention_level'], 'warning')

    def test_discounted_exact_payment_has_no_issue(self):
        master_class = self.master_class(discount_amount='1200.00')
        self.payment(master_class, payment_amount='16800.00', parts_total='16800.00')
        data = self.detail(master_class)
        self.assertEqual(data['amount_due'], '16800.00')
        self.assertEqual(data['payment_status'], 'paid')
        self.assertFalse(data['has_payment_mismatch'])
        self.assertEqual(data['payment_attention_level'], 'none')

    def test_exact_zero_and_future_partial_states(self):
        exact = self.master_class()
        self.payment(exact, payment_amount='18000.00', parts_total='18000.00')
        free = self.master_class(price='0.00')
        partial = self.master_class()
        self.payment(partial, payment_amount='5000.00', parts_total='5000.00')
        self.assertFalse(self.detail(exact)['has_payment_mismatch'])
        self.assertFalse(self.detail(free)['has_payment_mismatch'])
        partial_data = self.detail(partial)
        self.assertEqual(partial_data['payment_attention_level'], 'warning')
        self.assertEqual(partial_data['remaining_amount'], '13000.00')

    def test_legacy_overpayment_uses_payment_amount_fallback(self):
        master_class = self.master_class()
        transaction = FinanceTransaction.objects.create(
            branch=self.branch, transaction_type=FinanceTransaction.Type.INCOME,
            amount='19000.00', subtotal_amount='19000.00', source='master_class',
        )
        master_class.finance_transaction = transaction
        master_class.payment_amount = Decimal('19000.00')
        master_class.save(update_fields=('finance_transaction', 'payment_amount', 'updated_at'))
        data = self.detail(master_class)
        self.assertEqual(data['paid_total'], '19000.00')
        self.assertEqual(data['payment_mismatch_type'], 'overpaid')
        self.assertEqual(data['payment_mismatch_amount'], '1000.00')
        self.assertEqual(data['payment_attention_level'], 'critical')

    def test_payment_for_zero_amount_due_is_critical(self):
        master_class = self.master_class(price='0.00')
        transaction = FinanceTransaction.objects.create(
            branch=self.branch, transaction_type=FinanceTransaction.Type.INCOME,
            amount='1000.00', subtotal_amount='1000.00', source='master_class',
        )
        master_class.finance_transaction = transaction
        master_class.payment_amount = Decimal('1000.00')
        master_class.save(update_fields=('finance_transaction', 'payment_amount', 'updated_at'))
        data = self.detail(master_class)
        self.assertEqual(data['payment_attention_level'], 'critical')
        self.assertEqual(data['payment_mismatch_type'], 'overpaid')
        self.assertEqual(data['payment_mismatch_message'], 'Оплата внесена при нулевой сумме к оплате.')

    def test_paid_stage_partial_and_zero_are_critical(self):
        partial = self.master_class(stage=MasterClass.Stage.PAID)
        self.payment(partial, payment_amount='16800.00', parts_total='16800.00')
        zero = self.master_class(stage=MasterClass.Stage.PAID)
        partial_data = self.detail(partial)
        zero_data = self.detail(zero)
        self.assertEqual(partial_data['payment_attention_level'], 'critical')
        self.assertIn('не хватает 1 200 ₸', partial_data['payment_mismatch_message'])
        self.assertEqual(zero_data['payment_attention_level'], 'critical')
        self.assertIn('оплаты нет', zero_data['payment_mismatch_message'])

    def test_internal_transaction_and_parts_mismatches_are_aggregated(self):
        master_class = self.master_class(price='16800.00')
        self.payment(master_class, payment_amount='16800.00', transaction_amount='16000.00', parts_total='15000.00')
        data = self.detail(master_class)
        self.assertTrue(data['has_internal_payment_mismatch'])
        self.assertEqual(data['payment_attention_level'], 'critical')
        self.assertEqual({item['code'] for item in data['payment_issues']}, {
            'finance_transaction_mismatch', 'payment_parts_mismatch',
        })

    def test_payment_filters_include_monetary_and_internal_issues(self):
        partial = self.master_class()
        self.payment(partial, payment_amount='16800.00', parts_total='16800.00')
        exact = self.master_class()
        self.payment(exact, payment_amount='18000.00', parts_total='18000.00')
        internal = self.master_class(price='16800.00')
        self.payment(internal, payment_amount='16800.00', transaction_amount='16000.00', parts_total='16000.00')
        unpaid = self.master_class()

        issues = self.client.get('/api/master-classes/', {'payment_issue': '1'})
        underpaid = self.client.get('/api/master-classes/', {'payment_status': 'partial'})
        paid = self.client.get('/api/master-classes/', {'payment_status': 'paid'})
        no_payment = self.client.get('/api/master-classes/', {'payment_status': 'unpaid'})
        self.assertEqual({item['id'] for item in issues.data}, {partial.pk, internal.pk})
        self.assertEqual({item['id'] for item in underpaid.data}, {partial.pk})
        self.assertEqual({item['id'] for item in paid.data}, {exact.pk, internal.pk})
        self.assertEqual({item['id'] for item in no_payment.data}, {unpaid.pk})

    def test_list_diagnostics_do_not_add_queries_per_master_class(self):
        self.payment(self.master_class(), payment_amount='5000.00', parts_total='5000.00')
        with CaptureQueriesContext(connection) as first:
            self.client.get('/api/master-classes/')
        for _ in range(5):
            self.payment(self.master_class(), payment_amount='5000.00', parts_total='5000.00')
        with CaptureQueriesContext(connection) as larger:
            self.client.get('/api/master-classes/')
        self.assertLessEqual(len(larger), len(first) + 2, f'Queries grew from {len(first)} to {len(larger)}')
