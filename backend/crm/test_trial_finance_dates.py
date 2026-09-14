from datetime import date
from decimal import Decimal
from importlib import import_module
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import (
    AddonSale,
    Branch,
    CertificateBatch,
    Client,
    FinanceTransaction,
    GiftCertificate,
    MasterClass,
    MasterClassPayment,
    MasterClassSubject,
    PaymentMethod,
    PayrollStatement,
    Subscription,
    Trial,
)
from .payment_parts import sync_finance_payment_parts

DEFAULT_BRANCH = object()


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class TrialFinanceDatesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = get_user_model().objects.create_user(username='trial-finance-admin', role='admin', roles=['admin'])
        cls.branch = Branch.objects.create(name='Trial finance main')
        cls.other_branch = Branch.objects.create(name='Trial finance selected')
        cls.student = Client.objects.create(first_name='Trial student', branch=cls.branch)
        cls.cash = PaymentMethod.objects.create(name='Trial finance cash', code='trial-finance-cash', is_cash=True)
        cls.card = PaymentMethod.objects.create(name='Trial finance card', code='trial-finance-card')
        cls.subject = MasterClassSubject.objects.create(name='Trial finance MC')

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def income(self, *, amount=100, source='manual', branch=DEFAULT_BRANCH, split=False):
        item = FinanceTransaction.objects.create(
            transaction_type=FinanceTransaction.Type.INCOME,
            amount=Decimal(str(amount)),
            subtotal_amount=Decimal(str(amount)),
            source=source,
            branch=self.branch if branch is DEFAULT_BRANCH else branch,
            paid_at=timezone.datetime(2026, 9, 14, 0, tzinfo=timezone.get_fixed_timezone(0)),
        )
        parts = None
        if split:
            parts = [
                {'payment_method': self.cash, 'amount': Decimal('40')},
                {'payment_method': self.card, 'amount': Decimal(str(amount)) - Decimal('40')},
            ]
        sync_finance_payment_parts(item, parts, legacy_payment_method=self.cash)
        return item

    def subscription(self, **kwargs):
        values = dict(
            client=self.student,
            branch=self.branch,
            title='Trial finance subscription',
            start_date=date(2026, 9, 1),
            total_visits=4,
            remaining_visits=4,
            price=100,
        )
        values.update(kwargs)
        return Subscription.objects.create(**values)

    def master_class(self):
        item = MasterClass.objects.create(
            subject=self.subject,
            title=self.subject.name,
            branch=self.branch,
            starts_at=timezone.now(),
            price=100,
        )
        item.participants.add(self.student)
        return item

    def create_trial(self, **overrides):
        response = self.client.post('/api/trials/', {
            'client': self.student.pk,
            'branch': self.other_branch.pk,
            'manager': self.admin.pk,
            'scheduled_at': '2026-09-14T10:00:00Z',
            'price': '2000.00',
            'payment_date': '2026-09-14',
            'payment_method': self.cash.pk,
            **overrides,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return Trial.objects.get(pk=response.data['id'])

    def assert_finance_date(self, item, expected='2026-09-14', precision='date'):
        response = self.client.get(f'/api/finance/{item.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['paid_at_precision'], precision)
        self.assertEqual(str(response.data['paid_on']), expected)

    def test_trial_selected_branch_does_not_change_client(self):
        for client_branch in (None, self.branch):
            with self.subTest(client_branch=client_branch):
                self.student.branch = client_branch
                self.student.save()
                trial = self.create_trial()
                self.assertEqual(trial.finance_transaction.branch_id, self.other_branch.pk)
                self.assertEqual(trial.finance_transaction.manager_id, trial.manager_id)
                self.student.refresh_from_db()
                self.assertEqual(self.student.branch_id, getattr(client_branch, 'pk', None))
                trial.delete()

    def test_trial_delayed_payment_and_branch_patch(self):
        trial = self.create_trial(price=0, payment_date=None, payment_method=None)
        self.assertIsNone(trial.finance_transaction_id)
        for payload in (
            {'price': '2000', 'payment_date': '2026-09-14', 'payment_method': self.cash.pk},
            {'stage': 'attended'},
            {'branch': self.branch.pk},
        ):
            response = self.client.patch(f'/api/trials/{trial.pk}/', payload, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            trial.refresh_from_db()
            self.assertEqual(trial.finance_transaction.branch_id, trial.branch_id)
            self.assertEqual(trial.finance_transaction.manager_id, trial.manager_id)
        self.assertEqual(trial.finance_transaction.amount, Decimal('2000.00'))

    def test_trial_recreated_payment_uses_trial_branch(self):
        trial = self.create_trial()
        trial.finance_transaction.delete()
        response = self.client.patch(f'/api/trials/{trial.pk}/', {'payment_method': self.cash.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        trial.refresh_from_db()
        self.assertEqual(trial.finance_transaction.branch_id, self.other_branch.pk)

    def test_trial_finance_branch_filters_summary_and_cash(self):
        trial = self.create_trial()
        for branch, expected in ((self.other_branch, True), (self.branch, False)):
            response = self.client.get('/api/finance/', {'branch': branch.pk, 'date_from': '2026-09-14', 'date_to': '2026-09-14'})
            self.assertEqual(response.status_code, 200, response.data)
            rows = response.data.get('results', []) if isinstance(response.data, dict) else response.data
            self.assertEqual(any(row['id'] == trial.finance_transaction_id for row in rows), expected)
            summary = self.client.get('/api/finance/summary/', {'branch': branch.pk}).data
            self.assertEqual(Decimal(str(summary['income'])), Decimal('2000') if expected else Decimal('0'))
            cash = self.client.get('/api/finance/cash-balance/', {'branch': branch.pk}).data
            self.assertEqual(Decimal(str(cash['expected_balance'])), Decimal('2000') if expected else Decimal('0'))

    def test_trial_precision_uses_payment_date_without_rewriting_legacy_timestamp(self):
        trial = self.create_trial()
        item = trial.finance_transaction
        item.paid_at = timezone.datetime(2026, 9, 13, 0, tzinfo=timezone.get_fixed_timezone(0))
        item.save(update_fields=('paid_at',))
        self.assert_finance_date(item)
        item.refresh_from_db()
        self.assertEqual(item.paid_at.day, 13)

    def test_linked_date_only_sources_and_manual_source_labels(self):
        for source in ('subscription', 'camp', 'addon', 'product', 'retail', 'master_class', 'certificate', 'trial', 'manual'):
            with self.subTest(source=source):
                item = self.income(source=source)
                self.assert_finance_date(item, precision='datetime')
                if source in ('subscription', 'camp'):
                    self.subscription(finance_transaction=item, purchase_date=date(2026, 9, 14))
                elif source in ('addon', 'product', 'retail'):
                    AddonSale.objects.create(finance_transaction=item, sale_date=date(2026, 9, 14))
                elif source == 'master_class':
                    MasterClassPayment.objects.create(
                        master_class=self.master_class(),
                        finance_transaction=item,
                        amount=100,
                        payment_date=date(2026, 9, 14),
                    )
                elif source == 'certificate':
                    GiftCertificate.objects.create(
                        finance_transaction=item,
                        code=f'DATE-CERT-{item.pk}',
                        face_value=100,
                        sale_price=100,
                        remaining_amount=100,
                        issued_at=date(2026, 9, 14),
                        valid_until=date(2026, 12, 31),
                    )
                else:
                    continue
                self.assert_finance_date(item)

    def test_legacy_master_class_and_certificate_batch_dates(self):
        item = self.income()
        mc = self.master_class()
        mc.finance_transaction = item
        mc.payment_date = date(2026, 9, 14)
        mc.save(update_fields=('finance_transaction', 'payment_date', 'updated_at'))
        self.assert_finance_date(item)

        batch_item = self.income()
        CertificateBatch.objects.create(
            template_name='Batch',
            quantity=1,
            face_value_per_certificate=100,
            sale_price_per_certificate=100,
            total_face_value=100,
            total_sale_price=100,
            issued_at=date(2026, 9, 14),
            finance_transaction=batch_item,
            created_by=self.admin,
        )
        self.assert_finance_date(batch_item)

    def test_payroll_has_real_datetime(self):
        item = self.income()
        item.paid_at = timezone.datetime(2026, 9, 14, 10, 43, 27, tzinfo=timezone.get_fixed_timezone(0))
        item.save(update_fields=('paid_at',))
        PayrollStatement.objects.create(
            employee=self.admin,
            date_from=date(2026, 9, 1),
            date_to=date(2026, 9, 30),
            finance_transaction=item,
        )
        self.assert_finance_date(item, precision='datetime')

    def test_backfill_changes_only_unambiguous_trial_metadata_and_is_idempotent(self):
        migration = import_module('crm.migrations.0043_sync_trial_finance_metadata')
        historical_apps = MigrationLoader(connection).project_state([('crm', '0042_addonsaleitem_owner_name_catalogitem_owner_name')]).apps

        item = self.income(source='trial', branch=None)
        item.manager = self.admin
        item.save(update_fields=('manager',))
        trial = Trial.objects.create(
            client=self.student,
            branch=self.other_branch,
            manager=None,
            scheduled_at=timezone.now(),
            finance_transaction=item,
        )

        unrelated = self.income(branch=None)
        unrelated.branch = None
        unrelated.save(update_fields=('branch',))
        ambiguous = self.income(source='trial', branch=self.branch)
        Trial.objects.create(
            client=self.student,
            branch=self.other_branch,
            scheduled_at=timezone.now(),
            finance_transaction=ambiguous,
        )
        Subscription.objects.create(
            client=self.student,
            branch=self.branch,
            title='Ambiguous',
            start_date=date(2026, 9, 1),
            finance_transaction=ambiguous,
        )
        no_branch_item = self.income(source='trial', branch=None)
        no_branch_trial = Trial.objects.create(client=self.student, scheduled_at=timezone.now(), finance_transaction=no_branch_item)
        Trial.objects.filter(pk=no_branch_trial.pk).update(branch=None)

        before = (item.paid_at, item.amount, list(item.payment_parts.values_list('id', 'amount')))
        for _ in range(2):
            migration.sync_trial_finance_metadata(historical_apps, SimpleNamespace(connection=connection))

        item.refresh_from_db()
        unrelated.refresh_from_db()
        ambiguous.refresh_from_db()
        no_branch_item.refresh_from_db()
        self.assertEqual(item.branch_id, trial.branch_id)
        self.assertIsNone(item.manager_id)
        self.assertIsNone(unrelated.branch_id)
        self.assertEqual(ambiguous.branch_id, self.branch.pk)
        self.assertIsNone(no_branch_item.branch_id)
        self.assertEqual((item.paid_at, item.amount, list(item.payment_parts.values_list('id', 'amount'))), before)
