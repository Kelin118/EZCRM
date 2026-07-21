from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone
from rest_framework import serializers

from .models import Discount


MONEY = Decimal('0.01')


def money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def decimal_value(value):
    return Decimal(str(value or 0))


def is_discount_available(discount, *, branch=None, calculation_date=None):
    if not discount or not discount.is_active:
        return False
    calculation_date = calculation_date or timezone.localdate()
    if discount.valid_from and calculation_date < discount.valid_from:
        return False
    if discount.valid_until and calculation_date > discount.valid_until:
        return False
    branch_id = getattr(branch, 'id', branch)
    if discount.branch_id and branch_id and discount.branch_id != int(branch_id):
        return False
    if discount.branch_id and not branch_id:
        return False
    return True


def validate_discount_for_sale(discount, *, branch=None, calculation_date=None):
    if discount and not is_discount_available(discount, branch=branch, calculation_date=calculation_date):
        raise serializers.ValidationError('Выберите активную скидку, доступную для этой продажи.')
    return discount


def calculate_discount(subtotal, discount=None, *, branch=None, calculation_date=None):
    subtotal = money(subtotal)
    if not discount:
        return {
            'subtotal': subtotal,
            'discount': None,
            'discount_name': '',
            'discount_type': '',
            'discount_value': Decimal('0'),
            'discount_amount': Decimal('0.00'),
            'total_price': subtotal,
        }

    validate_discount_for_sale(discount, branch=branch, calculation_date=calculation_date)
    raw_value = decimal_value(discount.value)
    if discount.discount_type == Discount.Type.PERCENTAGE:
        value = raw_value
        discount_amount = money(subtotal * value / Decimal('100'))
    else:
        value = money(raw_value)
        discount_amount = value
    discount_amount = min(discount_amount, subtotal)

    return {
        'subtotal': subtotal,
        'discount': discount,
        'discount_name': discount.name,
        'discount_type': discount.discount_type,
        'discount_value': value,
        'discount_amount': discount_amount,
        'total_price': money(max(subtotal - discount_amount, Decimal('0.00'))),
    }


def apply_discount_snapshot(instance, result):
    instance.discount = result.get('discount')
    instance.discount_name = result.get('discount_name') or ''
    instance.discount_type = result.get('discount_type') or ''
    instance.discount_value = result.get('discount_value') or Decimal('0.00')
    instance.discount_amount = result.get('discount_amount') or Decimal('0.00')
    return instance
