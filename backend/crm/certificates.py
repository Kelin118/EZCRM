from django.db import transaction
from rest_framework import serializers

from .models import CertificateNumberSequence, GiftCertificate


def certificate_serial_code(number):
    return f'N{int(number):03d}' if number else ''


def allocate_certificate_numbers(quantity=1, start_number=None):
    quantity = int(quantity or 0)
    if quantity <= 0:
        raise serializers.ValidationError({'quantity': 'Количество сертификатов должно быть больше нуля.'})

    with transaction.atomic():
        sequence, _ = (
            CertificateNumberSequence.objects
            .select_for_update()
            .get_or_create(pk=1, defaults={'last_number': 0})
        )
        if start_number not in (None, ''):
            start = int(start_number)
            if start <= 0:
                raise serializers.ValidationError({'start_number': 'Начальный номер должен быть больше нуля.'})
            end = start + quantity - 1
            used = set(
                GiftCertificate.objects
                .filter(serial_number__gte=start, serial_number__lte=end)
                .values_list('serial_number', flat=True)
            )
            if used:
                first = min(used)
                raise serializers.ValidationError({
                    'start_number': f'Диапазон занят: номер {certificate_serial_code(first)} уже используется.'
                })
            sequence.last_number = max(sequence.last_number, end)
        else:
            start = sequence.last_number + 1
            end = start + quantity - 1
            sequence.last_number = end
        sequence.save(update_fields=('last_number', 'updated_at'))
        return list(range(start, end + 1))
