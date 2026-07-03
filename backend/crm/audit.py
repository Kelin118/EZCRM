from .models import AuditLog


def get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR') if request else ''
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR') if request else None


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

        AuditLog.objects.create(
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            entity_name=str(entity_name or '')[:255],
            description=description or '',
            changes=changes or {},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT', '') if request else ''),
        )
    except Exception:
        pass
