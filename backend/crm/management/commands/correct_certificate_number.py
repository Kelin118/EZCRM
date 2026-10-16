from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from crm.certificates import certificate_serial_code
from crm.models import AuditLog, CertificateNumberSequence, GiftCertificate


class Command(BaseCommand):
    help = 'Correct one unused certificate number and rebase the automatic sequence. Dry-run by default.'

    def add_arguments(self, parser):
        parser.add_argument('--from-number', type=int, required=True, help='Current certificate number.')
        parser.add_argument('--to-number', type=int, required=True, help='Correct number.')
        parser.add_argument('--apply', action='store_true', help='Apply the correction after all checks pass.')

    def handle(self, *args, **options):
        old_number = options['from_number']
        new_number = options['to_number']
        if old_number <= 0 or new_number <= 0 or old_number == new_number:
            raise CommandError('Укажите два разных положительных номера.')

        with transaction.atomic():
            sequence = CertificateNumberSequence.objects.select_for_update().filter(pk=1).first()
            if sequence is None:
                raise CommandError('Счётчик сертификатов не найден. Исправление остановлено.')
            certificate = GiftCertificate.objects.select_for_update().filter(serial_number=old_number).first()
            if certificate is None:
                raise CommandError(f'Сертификат {certificate_serial_code(old_number)} не найден.')
            if (certificate.sent_at or certificate.sent_to_phone or certificate.redemptions.exists()
                    or certificate.remaining_amount != certificate.face_value):
                raise CommandError('Сертификат отправлен или использован. Его номер менять нельзя.')
            if certificate.status not in {GiftCertificate.Status.ACTIVE, GiftCertificate.Status.DRAFT}:
                raise CommandError('Менять номер можно только у активного или чернового сертификата.')
            if certificate.batch_id and (
                certificate.batch.quantity != 1 or certificate.batch.certificates.exclude(pk=certificate.pk).exists()
            ):
                raise CommandError('Сертификат входит в партию. Исправление номера партии не поддерживается.')

            other_numbers = list(
                GiftCertificate.objects.exclude(pk=certificate.pk).order_by('serial_number')
                .values_list('serial_number', flat=True)
            )
            expected = list(range(1, new_number))
            if other_numbers != expected:
                raise CommandError(
                    'После исправления номера не образуется непрерывная последовательность от N001. '
                    'Проверьте все сертификаты, включая отменённые и архивные.'
                )
            if sequence.last_number < old_number:
                raise CommandError('Счётчик меньше текущего номера сертификата. Требуется отдельная проверка БД.')

            self.stdout.write(
                f'Сертификат #{certificate.pk}: {certificate_serial_code(old_number)} -> '
                f'{certificate_serial_code(new_number)}; счётчик {sequence.last_number} -> {new_number}. '
                'Код, ссылка, оплата и погашения не меняются.'
            )
            if certificate.finance_transaction_id:
                self.stdout.write(self.style.WARNING(
                    'Исторический комментарий финансовой операции не переписывается и может содержать прежний номер.'
                ))
            if not options['apply']:
                self.stdout.write(self.style.WARNING('DRY-RUN: изменений нет. Для применения добавьте --apply.'))
                return

            old_sequence_number = sequence.last_number
            certificate.serial_number = new_number
            certificate.save(update_fields=('serial_number', 'updated_at'))
            sequence.last_number = new_number
            sequence.save(update_fields=('last_number', 'updated_at'))
            AuditLog.objects.create(
                action=AuditLog.Action.UPDATE,
                entity_type='GiftCertificate',
                entity_id=str(certificate.pk),
                entity_name=certificate.serial_code,
                description='Исправлен номер сертификата и счётчик выдачи',
                changes={
                    'old_serial_code': certificate_serial_code(old_number),
                    'new_serial_code': certificate.serial_code,
                    'old_sequence_number': old_sequence_number,
                    'new_sequence_number': new_number,
                },
            )
            self.stdout.write(self.style.SUCCESS('Номер исправлен. Следующий автоматический номер будет '
                                                 f'{certificate_serial_code(new_number + 1)}.'))
