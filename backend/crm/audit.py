from .models import AuditLog


SENSITIVE_KEYS = {'password', 'password_confirm', 'old_password', 'new_password', 'token', 'access', 'refresh'}


def get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR') if request else ''
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR') if request else None


def sanitize_changes(value):
    if isinstance(value, dict):
        return {
            key: sanitize_changes(item)
            for key, item in value.items()
            if str(key).lower() not in SENSITIVE_KEYS and 'password' not in str(key).lower()
        }
    if isinstance(value, list):
        return [sanitize_changes(item) for item in value]
    return value


def log_action(
    request,
    action,
    entity_type,
    entity_id=None,
    entity_name='',
    description='',
    changes=None,
):
    try:
        user = getattr(request, 'user', None)
        if not getattr(user, 'is_authenticated', False):
            user = None
        safe_changes = sanitize_changes(changes or {})

        AuditLog.objects.create(
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else '',
            entity_name=str(entity_name or '')[:255],
            description=description or '',
            changes=safe_changes,
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT', '') if request else ''),
        )
    except Exception:
        pass
