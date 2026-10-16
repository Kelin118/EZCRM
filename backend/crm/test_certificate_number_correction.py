from datetime import date
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from crm.certificates import allocate_certificate_numbers
from crm.models import AuditLog, CertificateNumberSequence, GiftCertificate


class CertificateNumberCorrectionTests(TestCase):
    def setUp(self):
        self.first = self._certificate(1)
        self.second = self._certificate(58)
        CertificateNumberSequence.objects.update_or_create(pk=1, defaults={'last_number': 58})

    @staticmethod
    def _certificate(number, **overrides):
        data = {
            'serial_number': number,
            'code': f'TEST-CERT-{number}',
            'face_value': Decimal('10000.00'),
            'sale_price': Decimal('10000.00'),
            'remaining_amount': Decimal('10000.00'),
            'valid_until': date(2027, 12, 31),
        }
        data.update(overrides)
        return GiftCertificate.objects.create(**data)

    def run_correction(self, *args):
        return call_command('correct_certificate_number', '--from-number', '58', '--to-number', '2',
                            *args, stdout=StringIO())

    def test_dry_run_does_not_change_number_sequence_or_audit(self):
        self.run_correction()
        self.second.refresh_from_db()
        self.assertEqual(self.second.serial_number, 58)
        self.assertEqual(CertificateNumberSequence.objects.get(pk=1).last_number, 58)
        self.assertFalse(AuditLog.objects.exists())

    def test_apply_corrects_one_number_and_next_allocation(self):
        original_code = self.second.code
        original_token = self.second.public_token
        self.run_correction('--apply')
        self.second.refresh_from_db()
        self.assertEqual(self.second.serial_code, 'N002')
        self.assertEqual(self.second.code, original_code)
        self.assertEqual(self.second.public_token, original_token)
        self.assertEqual(CertificateNumberSequence.objects.get(pk=1).last_number, 2)
        log = AuditLog.objects.get(entity_type='GiftCertificate', entity_id=str(self.second.pk))
        self.assertEqual(log.changes['old_serial_code'], 'N058')
        self.assertEqual(log.changes['new_serial_code'], 'N002')
        self.assertEqual(allocate_certificate_numbers(1), [3])

    def test_apply_refuses_other_existing_numbers(self):
        self._certificate(3)
        with self.assertRaises(CommandError):
            self.run_correction('--apply')
        self.second.refresh_from_db()
        self.assertEqual(self.second.serial_number, 58)
        self.assertEqual(CertificateNumberSequence.objects.get(pk=1).last_number, 58)

    def test_apply_refuses_sent_certificate(self):
        from django.utils import timezone

        self.second.sent_at = timezone.now()
        self.second.save(update_fields=('sent_at',))
        with self.assertRaises(CommandError):
            self.run_correction('--apply')
        self.second.refresh_from_db()
        self.assertEqual(self.second.serial_number, 58)

    def test_apply_refuses_certificate_with_sent_phone_without_timestamp(self):
        self.second.sent_to_phone = '+77770000000'
        self.second.save(update_fields=('sent_to_phone',))
        with self.assertRaises(CommandError):
            self.run_correction('--apply')
        self.assertEqual(CertificateNumberSequence.objects.get(pk=1).last_number, 58)
