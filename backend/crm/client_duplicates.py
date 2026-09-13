from collections import defaultdict

from django.db import transaction
from rest_framework import serializers

from .models import (
    AddonSale,
    CertificateBatch,
    ChatMessage,
    Client,
    FinanceTransaction,
    GiftCertificate,
    GroupMembership,
    Lead,
    MasterClass,
    MessagingContact,
    Subscription,
    Task,
    Trial,
    Visit,
)
from .phone import normalize_kz_phone


USAGE_FIELDS = {
    'subscriptions_count': lambda client: client.subscriptions.count(),
    'finance_count': lambda client: client.finance_transactions.count(),
    'visits_count': lambda client: client.visits.count(),
    'trials_count': lambda client: client.trials.count(),
    'master_classes_count': lambda client: client.master_classes.count(),
    'leads_count': lambda client: client.leads.count(),
    'tasks_count': lambda client: client.tasks.count(),
    'addon_sales_count': lambda client: client.addon_sales.count(),
    'certificate_batches_count': lambda client: client.certificate_batches.count(),
    'certificates_count': lambda client: client.purchased_certificates.count(),
    'group_memberships_count': lambda client: client.group_memberships.count(),
    'chat_messages_count': lambda client: client.chat_messages.count(),
    'messaging_contacts_count': lambda client: client.messaging_contacts.count(),
}


def client_usage(client):
    return {key: counter(client) for key, counter in USAGE_FIELDS.items()}


def has_client_usage(client):
    return any(client_usage(client).values())


def clients_payload(clients):
    return [
        {
            'id': client.id,
            'full_name': str(client),
            'phone': client.phone,
            'branch': client.branch_id,
            'branch_name': client.branch.name if client.branch else '',
            'manager': client.manager_id,
            'manager_name': client.manager.get_full_name() or client.manager.username if client.manager else '',
            'is_active': client.is_active,
            'usage': client_usage(client),
        }
        for client in clients
    ]


def duplicate_phone_groups(queryset=None):
    queryset = queryset or Client.objects.all()
    groups = defaultdict(list)
    for client_id, phone in queryset.values_list('id', 'phone'):
        normalized = normalize_kz_phone(phone)
        if normalized:
            groups[normalized].append(client_id)
    return {phone: ids for phone, ids in groups.items() if len(ids) > 1}


def duplicate_info_map(queryset=None):
    groups = duplicate_phone_groups(queryset)
    info = {}
    for normalized, ids in groups.items():
        for client_id in ids:
            info[client_id] = {
                'normalized_phone': normalized,
                'duplicate_phone_count': len(ids),
                'has_phone_duplicate': True,
                'duplicate_client_ids': [item_id for item_id in ids if item_id != client_id],
            }
    return info


def default_duplicate_info(phone=''):
    normalized = normalize_kz_phone(phone)
    return {
        'normalized_phone': normalized,
        'duplicate_phone_count': 0,
        'has_phone_duplicate': False,
        'duplicate_client_ids': [],
    }


def duplicate_clients_for_phone(phone, exclude_client=None):
    normalized = normalize_kz_phone(phone)
    if not normalized:
        return normalized, []
    ids = [
        client_id
        for client_id, client_phone in Client.objects.values_list('id', 'phone')
        if normalize_kz_phone(client_phone) == normalized and client_id != exclude_client
    ]
    clients = Client.objects.select_related('branch', 'manager').filter(id__in=ids).order_by('first_name', 'last_name', 'id')
    return normalized, list(clients)


def fill_primary_empty_fields(primary, duplicate):
    fields = ('phone', 'last_name', 'parent_name', 'email', 'birth_date', 'school_class', 'direction')
    update_fields = []
    for field in fields:
        if not getattr(primary, field) and getattr(duplicate, field):
            setattr(primary, field, getattr(duplicate, field))
            update_fields.append(field)
    if update_fields:
        update_fields.append('updated_at')
        primary.save(update_fields=update_fields)


def merge_group_memberships(primary, duplicate):
    for membership in GroupMembership.objects.select_for_update().filter(client=duplicate):
        conflict = GroupMembership.objects.filter(
            group=membership.group,
            client=primary,
            status=GroupMembership.Status.ACTIVE,
        ).exclude(pk=membership.pk).first()
        if conflict and membership.status == GroupMembership.Status.ACTIVE:
            membership.status = GroupMembership.Status.LEFT
            membership.note = '\n'.join(filter(None, [membership.note, f'Дубль объединён с клиентом #{primary.id}.']))
            membership.save(update_fields=('status', 'note', 'updated_at'))
        membership.client = primary
        membership.save(update_fields=('client', 'updated_at'))


def merge_master_class_participants(primary, duplicate):
    through = MasterClass.participants.through
    master_class_ids = list(duplicate.master_classes.values_list('id', flat=True))
    for master_class_id in master_class_ids:
        through.objects.get_or_create(masterclass_id=master_class_id, client_id=primary.id)
    through.objects.filter(masterclass_id__in=master_class_ids, client_id=duplicate.id).delete()


def merge_clients(*, primary, duplicate):
    if primary.id == duplicate.id:
        raise serializers.ValidationError({'duplicate_client': 'Выберите другого клиента для объединения.'})

    with transaction.atomic():
        locked = Client.objects.select_for_update().filter(id__in=[primary.id, duplicate.id]).in_bulk()
        primary = locked.get(primary.id)
        duplicate = locked.get(duplicate.id)
        if not primary or not duplicate:
            raise serializers.ValidationError({'detail': 'Клиент не найден.'})

        fill_primary_empty_fields(primary, duplicate)
        Subscription.objects.filter(client=duplicate).update(client=primary)
        Visit.objects.filter(client=duplicate).update(client=primary)
        Trial.objects.filter(client=duplicate).update(client=primary)
        Task.objects.filter(client=duplicate).update(client=primary)
        FinanceTransaction.objects.filter(client=duplicate).update(client=primary)
        Lead.objects.filter(client=duplicate).update(client=primary)
        MessagingContact.objects.filter(client=duplicate).update(client=primary)
        AddonSale.objects.filter(client=duplicate).update(client=primary)
        CertificateBatch.objects.filter(purchaser_client=duplicate).update(purchaser_client=primary)
        GiftCertificate.objects.filter(purchaser_client=duplicate).update(purchaser_client=primary)
        ChatMessage.objects.filter(client=duplicate).update(client=primary)
        merge_master_class_participants(primary, duplicate)
        merge_group_memberships(primary, duplicate)
        duplicate_id = duplicate.id
        duplicate_name = str(duplicate)
        duplicate.delete()

    primary.refresh_from_db()
    return primary, {'merged_client_id': duplicate_id, 'merged_client_name': duplicate_name}
