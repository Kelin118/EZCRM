from decimal import Decimal

from rest_framework import serializers

from .models import CatalogItem, SubscriptionAddon


def normalize_addons_payload(value):
    if value in (None, '', []):
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError('Дополнительные услуги должны быть списком.')

    normalized = []
    seen = set()
    for item in value:
        if isinstance(item, dict):
            catalog_item_id = item.get('catalog_item') or item.get('id')
            quantity = item.get('quantity') or 1
        else:
            catalog_item_id = item
            quantity = 1

        try:
            catalog_item_id = int(catalog_item_id)
            quantity = int(quantity)
        except (TypeError, ValueError):
            raise serializers.ValidationError('Некорректная дополнительная услуга.')

        if quantity < 1:
            raise serializers.ValidationError('Количество доп. услуги должно быть больше 0.')

        if catalog_item_id in seen:
            for existing in normalized:
                if existing['catalog_item_id'] == catalog_item_id:
                    existing['quantity'] += quantity
                    break
            continue

        seen.add(catalog_item_id)
        normalized.append({'catalog_item_id': catalog_item_id, 'quantity': quantity})

    return normalized


def validate_addons_payload(value, *, require_active=True):
    normalized = normalize_addons_payload(value)
    result = []
    for item in normalized:
        catalog_item = CatalogItem.objects.filter(pk=item['catalog_item_id']).first()
        if not catalog_item:
            raise serializers.ValidationError('Дополнительная услуга не найдена.')
        if catalog_item.category != CatalogItem.Category.ADDON:
            raise serializers.ValidationError('Выберите позицию из раздела доп. услуг.')
        if require_active and not catalog_item.is_active:
            raise serializers.ValidationError('Выберите активную доп. услугу.')
        result.append({'catalog_item': catalog_item, 'quantity': item['quantity']})
    return result


def sync_subscription_addons(subscription, addons):
    keep_ids = []
    for item in addons:
        catalog_item = item['catalog_item']
        quantity = item['quantity']
        existing = subscription.subscription_addons.filter(catalog_item=catalog_item).first()
        if existing:
            existing.quantity = quantity
            existing.total_price = existing.unit_price * Decimal(quantity)
            existing.save(update_fields=('quantity', 'total_price'))
            keep_ids.append(existing.id)
            continue

        addon = SubscriptionAddon.objects.create(
            subscription=subscription,
            catalog_item=catalog_item,
            name=catalog_item.name,
            unit_price=catalog_item.price,
            quantity=quantity,
            total_price=catalog_item.price * Decimal(quantity),
        )
        keep_ids.append(addon.id)

    subscription.subscription_addons.exclude(id__in=keep_ids).delete()
    return subscription


def addons_total(subscription):
    return sum((addon.total_price for addon in subscription.subscription_addons.all()), Decimal('0'))


def total_price(subscription):
    subtotal = Decimal(subscription.price or 0) + addons_total(subscription)
    discount_amount = Decimal(getattr(subscription, 'discount_amount', 0) or 0)
    return max(subtotal - discount_amount, Decimal('0'))


def addons_comment(subscription, base_comment='Оплата абонемента'):
    names = [subscription.title] + [addon.name for addon in subscription.subscription_addons.all()]
    details = ' + '.join(filter(None, names))
    return f'{base_comment}: {details}' if details else base_comment
