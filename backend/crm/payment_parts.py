from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction as db_transaction
from rest_framework import serializers

from .models import FinancePaymentPart, PaymentMethod


MONEY = Decimal('0.01')
MIXED_PAYMENT_NAME = 'Смешанная оплата'


def money(value):
    return Decimal(str(value or 0)).quantize(MONEY, rounding=ROUND_HALF_UP)


def payment_parts_representation(transaction):
    return [
        {
            'id': part.id,
            'payment_method': part.payment_method_id,
            'payment_method_name': part.payment_method_name,
            'is_cash': bool(part.payment_method and part.payment_method.is_cash),
            'amount': part.amount,
        }
        for part in transaction.payment_parts.select_related('payment_method').all()
    ]


def payment_parts_audit(transaction):
    return [
        {
            'payment_method_name': part.payment_method_name,
            'amount': str(part.amount),
        }
        for part in transaction.payment_parts.select_related('payment_method').all()
    ]


def validate_payment_parts(payment_parts, *, total_amount, legacy_payment_method=None):
    total_amount = money(total_amount)
    if total_amount <= 0:
        if payment_parts:
            raise serializers.ValidationError({'payment_parts': 'Для нулевой суммы части оплаты не нужны.'})
        return []

    if payment_parts in (None, ''):
        if legacy_payment_method:
            return [{'payment_method': legacy_payment_method, 'amount': total_amount}]
        raise serializers.ValidationError({'payment_parts': 'Укажите разбивку оплаты.'})

    if not isinstance(payment_parts, list):
        raise serializers.ValidationError({'payment_parts': 'Разбивка оплаты должна быть списком.'})
    if not payment_parts:
        raise serializers.ValidationError({'payment_parts': 'Добавьте хотя бы один способ оплаты.'})

    normalized = []
    method_ids = set()
    parts_total = Decimal('0.00')
    for index, item in enumerate(payment_parts):
        method_value = item.get('payment_method') if isinstance(item, dict) else None
        amount_value = item.get('amount') if isinstance(item, dict) else None
        try:
            method = method_value if isinstance(method_value, PaymentMethod) else PaymentMethod.objects.get(pk=method_value)
        except (PaymentMethod.DoesNotExist, TypeError, ValueError):
            raise serializers.ValidationError({'payment_parts': f'Способ оплаты в строке {index + 1} не найден.'})
        if not method.is_active:
            raise serializers.ValidationError({'payment_parts': f'Способ оплаты «{method.name}» отключён.'})
        if method.id in method_ids:
            raise serializers.ValidationError({'payment_parts': 'Один способ оплаты нельзя выбрать дважды.'})
        amount = money(amount_value)
        if amount <= 0:
            raise serializers.ValidationError({'payment_parts': 'Сумма каждой части должна быть больше нуля.'})
        method_ids.add(method.id)
        parts_total += amount
        normalized.append({'payment_method': method, 'amount': amount})

    if parts_total != total_amount:
        raise serializers.ValidationError({'payment_parts': 'Сумма частей оплаты должна совпадать с суммой операции.'})
    return normalized


def sync_finance_payment_parts(transaction, payment_parts=None, *, legacy_payment_method=None):
    normalized = validate_payment_parts(
        payment_parts,
        total_amount=transaction.amount,
        legacy_payment_method=legacy_payment_method,
    )
    with db_transaction.atomic():
        transaction.payment_parts.all().delete()
        for item in normalized:
            method = item['payment_method']
            FinancePaymentPart.objects.create(
                transaction=transaction,
                payment_method=method,
                payment_method_name=method.name,
                amount=item['amount'],
            )

        if len(normalized) == 1:
            method = normalized[0]['payment_method']
            transaction.payment_method = method
            transaction.payment_method_name = method.name
        elif len(normalized) > 1:
            transaction.payment_method = None
            transaction.payment_method_name = MIXED_PAYMENT_NAME
        else:
            transaction.payment_method = None
            transaction.payment_method_name = ''
        transaction.save(update_fields=('payment_method', 'payment_method_name', 'updated_at'))
    return transaction
