import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .audit import log_action
from .models import AuditLog, Client, Lead, LeadMessage, MessagingChannel, MessagingContact, MetaWebhookEvent
from .permissions import MANAGER


def normalize_kz_phone(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if len(digits) == 11 and digits.startswith('8'):
        return f'7{digits[1:]}'
    if len(digits) == 10:
        return f'7{digits}'
    return digits


def verify_meta_signature(body, signature):
    if getattr(settings, 'META_WEBHOOK_DISABLE_SIGNATURE_VALIDATION', False):
        return True
    app_secret = getattr(settings, 'META_APP_SECRET', '')
    if not app_secret or not signature or not signature.startswith('sha256='):
        return False
    digest = hmac.new(app_secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, f'sha256={digest}')


def parse_meta_datetime(value):
    try:
        timestamp = int(str(value)[:10])
        return datetime.fromtimestamp(timestamp, tz=timezone.get_current_timezone())
    except Exception:
        return timezone.now()


def safe_payload(payload):
    # Meta payloads do not contain app secrets/access tokens by default; keep this
    # defensive scrubber so diagnostics never persist accidental credentials.
    if isinstance(payload, dict):
        return {
            key: safe_payload(value)
            for key, value in payload.items()
            if 'token' not in str(key).lower() and 'secret' not in str(key).lower()
        }
    if isinstance(payload, list):
        return [safe_payload(item) for item in payload]
    return payload


def event_key(provider, message_id, raw_event):
    if message_id:
        return f'{provider}:{message_id}'
    encoded = json.dumps(raw_event, sort_keys=True, ensure_ascii=False).encode('utf-8')
    return f'{provider}:sha256:{hashlib.sha256(encoded).hexdigest()}'


@dataclass
class ParsedMessage:
    provider: str
    account_id: str
    contact_id: str
    external_message_id: str
    sent_at: object
    message_type: str = LeadMessage.MessageType.TEXT
    text: str = ''
    display_name: str = ''
    phone: str = ''
    username: str = ''
    media_id: str = ''
    mime_type: str = ''
    file_name: str = ''
    raw_payload: dict = None


def whatsapp_text_and_media(message):
    msg_type = message.get('type') or LeadMessage.MessageType.UNKNOWN
    text = ''
    media_id = ''
    mime_type = ''
    file_name = ''
    if msg_type == 'text':
        text = message.get('text', {}).get('body', '')
    elif msg_type in {'image', 'video', 'audio', 'document', 'sticker'}:
        media = message.get(msg_type, {})
        media_id = media.get('id', '')
        mime_type = media.get('mime_type', '')
        file_name = media.get('filename', '')
        caption = media.get('caption', '')
        if msg_type == 'image':
            text = caption or 'Изображение'
        elif msg_type == 'audio':
            text = caption or 'Аудиосообщение'
        elif msg_type == 'document':
            text = caption or f'Документ: {file_name or media_id}'
        else:
            text = caption or msg_type
    elif msg_type == 'interactive':
        interactive = message.get('interactive', {})
        text = (
            interactive.get('button_reply', {}).get('title')
            or interactive.get('list_reply', {}).get('title')
            or ''
        )
    elif msg_type == 'button':
        text = message.get('button', {}).get('text', '')
    return msg_type if msg_type in LeadMessage.MessageType.values else LeadMessage.MessageType.UNKNOWN, text, media_id, mime_type, file_name


def parse_whatsapp(payload):
    messages = []
    for entry in payload.get('entry', []):
        for change in entry.get('changes', []):
            value = change.get('value', {})
            account_id = value.get('metadata', {}).get('phone_number_id', '')
            contacts = {
                item.get('wa_id'): item.get('profile', {}).get('name', '')
                for item in value.get('contacts', [])
            }
            for message in value.get('messages', []) or []:
                message_id = message.get('id')
                sender = message.get('from')
                if not message_id or not sender:
                    continue
                msg_type, text, media_id, mime_type, file_name = whatsapp_text_and_media(message)
                phone = normalize_kz_phone(sender)
                messages.append(ParsedMessage(
                    provider=MessagingChannel.Provider.WHATSAPP,
                    account_id=account_id,
                    contact_id=phone or sender,
                    external_message_id=message_id,
                    sent_at=parse_meta_datetime(message.get('timestamp')),
                    message_type=msg_type,
                    text=text,
                    display_name=contacts.get(sender, ''),
                    phone=phone,
                    media_id=media_id,
                    mime_type=mime_type,
                    file_name=file_name,
                    raw_payload=message,
                ))
    return messages


def parse_instagram(payload):
    messages = []
    for entry in payload.get('entry', []):
        entry_account_id = entry.get('id', '')
        for event in entry.get('messaging', []) or []:
            message = event.get('message') or {}
            if message.get('is_echo') or event.get('read') or event.get('delivery') or event.get('messaging_seen'):
                continue
            message_id = message.get('mid')
            sender_id = event.get('sender', {}).get('id')
            recipient_id = event.get('recipient', {}).get('id') or entry_account_id
            if not message_id or not sender_id:
                continue
            msg_type = LeadMessage.MessageType.TEXT
            text = message.get('text', '')
            media_id = ''
            attachments = message.get('attachments') or []
            if attachments and not text:
                first = attachments[0]
                msg_type = first.get('type') if first.get('type') in LeadMessage.MessageType.values else LeadMessage.MessageType.UNKNOWN
                media_id = first.get('payload', {}).get('url', '')
                text = msg_type
            messages.append(ParsedMessage(
                provider=MessagingChannel.Provider.INSTAGRAM,
                account_id=recipient_id,
                contact_id=sender_id,
                external_message_id=message_id,
                sent_at=parse_meta_datetime(event.get('timestamp')),
                message_type=msg_type,
                text=text,
                username='',
                media_id=media_id,
                raw_payload=event,
            ))
    return messages


def parse_meta_messages(payload):
    object_type = payload.get('object', '')
    if object_type == 'whatsapp_business_account':
        return MessagingChannel.Provider.WHATSAPP, parse_whatsapp(payload)
    if object_type in {'instagram', 'page'}:
        return MessagingChannel.Provider.INSTAGRAM, parse_instagram(payload)
    return object_type or 'unknown', []


def first_manager():
    User = get_user_model()
    for user in User.objects.filter(is_active=True).order_by('id'):
        if hasattr(user, 'has_role') and user.has_role(MANAGER):
            return user
        if getattr(user, 'role', '') == MANAGER:
            return user
    return None


def find_client_by_phone(phone):
    normalized = normalize_kz_phone(phone)
    if not normalized:
        return None, False
    matches = [client for client in Client.objects.all() if normalize_kz_phone(client.phone) == normalized]
    if len(matches) == 1:
        return matches[0], False
    return None, len(matches) > 1


def lead_title(parsed, client=None):
    if parsed.provider == MessagingChannel.Provider.WHATSAPP:
        return f'WhatsApp · {client or parsed.display_name or parsed.phone or parsed.contact_id}'
    if parsed.username:
        return f'Instagram · @{parsed.username}'
    return f'Instagram · {parsed.contact_id}'


def create_or_update_from_message(request, parsed):
    channel = MessagingChannel.objects.filter(
        provider=parsed.provider,
        external_account_id=parsed.account_id,
    ).select_related('branch', 'default_manager').first()
    key = event_key(parsed.provider, parsed.external_message_id, parsed.raw_payload or {})
    event, created = MetaWebhookEvent.objects.get_or_create(
        event_key=key,
        defaults={
            'provider': parsed.provider,
            'object_type': parsed.provider,
            'payload': safe_payload(parsed.raw_payload or {}),
        },
    )
    if not created and event.processed_at:
        return None, event
    if not channel or not channel.is_active:
        event.processing_error = 'MessagingChannel не найден или выключен.'
        event.processed_at = timezone.now()
        event.save(update_fields=('processing_error', 'processed_at', 'updated_at'))
        if channel:
            channel.last_error = event.processing_error
            channel.last_webhook_at = timezone.now()
            channel.save(update_fields=('last_error', 'last_webhook_at', 'updated_at'))
        return None, event

    client = None
    multiple_clients = False
    if parsed.provider == MessagingChannel.Provider.WHATSAPP:
        client, multiple_clients = find_client_by_phone(parsed.phone)

    with transaction.atomic():
        contact, _ = MessagingContact.objects.select_for_update().get_or_create(
            channel=channel,
            external_contact_id=parsed.contact_id,
            defaults={
                'display_name': parsed.display_name,
                'phone': parsed.phone,
                'username': parsed.username,
                'client': client,
            },
        )
        contact.display_name = parsed.display_name or contact.display_name
        contact.phone = parsed.phone or contact.phone
        contact.username = parsed.username or contact.username
        if client and not contact.client_id:
            contact.client = client
        contact.last_message_at = parsed.sent_at
        contact.save(update_fields=('display_name', 'phone', 'username', 'client', 'last_message_at', 'updated_at'))

        lead = (
            Lead.objects
            .select_for_update()
            .filter(contact=contact, status__in=Lead.ACTIVE_STATUSES)
            .order_by('-last_message_at')
            .first()
        )
        manager = channel.default_manager or (client.manager if client and client.manager_id else None) or first_manager()
        if manager and hasattr(manager, 'has_role') and not manager.has_role(MANAGER) and not getattr(manager, 'is_superuser', False):
            manager = first_manager()
        branch = channel.branch or (client.branch if client and client.branch_id else None)
        title = lead_title(parsed, client)
        if not lead:
            lead = Lead.objects.create(
                source=parsed.provider,
                channel=channel,
                contact=contact,
                client=client,
                manager=manager,
                branch=branch,
                title=title,
                contact_name=(str(client) if client else parsed.display_name),
                contact_phone=parsed.phone,
                contact_username=parsed.username,
                first_message=parsed.text,
                last_message=parsed.text,
                first_message_at=parsed.sent_at,
                last_message_at=parsed.sent_at,
                unread_count=1,
                notes='Найдено несколько клиентов с таким телефоном.' if multiple_clients else '',
            )
            log_action(request, AuditLog.Action.LEAD_CREATED_FROM_MESSAGE, 'Lead', entity_id=lead.pk, entity_name=lead.title, changes={
                'source': lead.source,
                'external_contact_id': parsed.contact_id,
                'contact_name': lead.contact_name,
                'normalized_phone': parsed.phone,
                'external_message_id': parsed.external_message_id,
                'channel': channel.pk,
                'assigned_manager': manager.pk if manager else None,
                'linked_client': client.pk if client else None,
            })
        else:
            lead.last_message = parsed.text
            lead.last_message_at = parsed.sent_at
            lead.unread_count += 1
            if client and not lead.client_id:
                lead.client = client
            lead.save(update_fields=('last_message', 'last_message_at', 'unread_count', 'client', 'updated_at'))

        LeadMessage.objects.get_or_create(
            external_message_id=parsed.external_message_id,
            defaults={
                'lead': lead,
                'contact': contact,
                'direction': LeadMessage.Direction.INBOUND,
                'message_type': parsed.message_type,
                'text': parsed.text,
                'media_id': parsed.media_id,
                'mime_type': parsed.mime_type,
                'file_name': parsed.file_name,
                'sent_at': parsed.sent_at,
                'raw_payload': safe_payload(parsed.raw_payload or {}),
                'is_read': False,
            },
        )
        channel.last_webhook_at = timezone.now()
        channel.last_message_at = parsed.sent_at
        channel.last_error = ''
        channel.save(update_fields=('last_webhook_at', 'last_message_at', 'last_error', 'updated_at'))
        event.processed_at = timezone.now()
        event.processing_error = ''
        event.save(update_fields=('processed_at', 'processing_error', 'updated_at'))
    return lead, event


def process_meta_webhook(request, payload):
    provider, messages = parse_meta_messages(payload)
    if not messages:
        key = event_key(str(provider), '', payload)
        event, _ = MetaWebhookEvent.objects.get_or_create(
            event_key=key,
            defaults={'provider': str(provider), 'object_type': payload.get('object', ''), 'payload': safe_payload(payload)},
        )
        event.processed_at = timezone.now()
        if payload.get('object') not in {'whatsapp_business_account', 'instagram', 'page'}:
            event.processing_error = 'Unsupported Meta webhook object.'
            log_action(request, AuditLog.Action.META_WEBHOOK_ERROR, 'MetaWebhookEvent', entity_id=event.pk, entity_name=event.event_key, changes={'error': event.processing_error})
        event.save(update_fields=('processed_at', 'processing_error', 'updated_at'))
        return []
    leads = []
    for parsed in messages:
        lead, _event = create_or_update_from_message(request, parsed)
        if lead:
            leads.append(lead)
    return leads
