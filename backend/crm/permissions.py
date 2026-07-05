from rest_framework.permissions import SAFE_METHODS, BasePermission


ADMIN = 'admin'
MANAGER = 'manager'
TEACHER = 'teacher'
ACCOUNTANT = 'accountant'


def role(user):
    return getattr(user, 'role', None)


def roles(user):
    if hasattr(user, 'get_roles'):
        return user.get_roles()
    user_role = role(user)
    return [user_role] if user_role else []


def has_role(user, role_name):
    if hasattr(user, 'has_role'):
        return user.has_role(role_name)
    return getattr(user, 'is_superuser', False) or role(user) == role_name


def has_any_role(user, role_names):
    if hasattr(user, 'has_any_role'):
        return user.has_any_role(role_names)
    return getattr(user, 'is_superuser', False) or role(user) in role_names


def is_admin(user):
    return has_role(user, ADMIN) or getattr(user, 'is_superuser', False)


def is_authenticated(user):
    return bool(user and user.is_authenticated)


class RolePermission(BasePermission):
    allowed_by_role = {}

    def has_permission(self, request, view):
        if not is_authenticated(request.user):
            return False
        if is_admin(request.user):
            return True

        action = getattr(view, 'action', None) or request.method.lower()
        allowed_actions = set()
        for user_role in roles(request.user):
            allowed_actions.update(self.allowed_by_role.get(user_role, set()))
        return action in allowed_actions or (request.method in SAFE_METHODS and 'read' in allowed_actions)

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and is_admin(request.user)


class AuditLogPermission(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS and is_authenticated(request.user) and is_admin(request.user)


class ClientPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
        TEACHER: {'read', 'list', 'retrieve'},
        ACCOUNTANT: {'read', 'list', 'retrieve'},
    }


class SubscriptionPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
        TEACHER: {'read', 'list', 'retrieve'},
        ACCOUNTANT: {'read', 'list', 'retrieve', 'update', 'partial_update'},
    }


class VisitPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
        TEACHER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
        ACCOUNTANT: {'read', 'list', 'retrieve'},
    }


class TrialPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update', 'convert_to_subscription'},
        TEACHER: {'read', 'list', 'retrieve'},
        ACCOUNTANT: {'read', 'list', 'retrieve'},
    }


class MasterClassPermission(TrialPermission):
    pass


class TaskPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update', 'destroy', 'mark_done'},
        TEACHER: {'read', 'list', 'retrieve', 'update', 'partial_update', 'mark_done'},
    }

    def has_object_permission(self, request, view, obj):
        if is_admin(request.user):
            return True
        action = getattr(view, 'action', None)

        if has_role(request.user, MANAGER):
            if action == 'destroy':
                return obj.assigned_to_id == request.user.id
            return True

        if has_role(request.user, TEACHER):
            return obj.assigned_to_id == request.user.id and action in {
                'retrieve',
                'update',
                'partial_update',
                'mark_done',
            }

        return False


class FinancePermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve'},
        ACCOUNTANT: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update', 'destroy'},
    }


class SettingsPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve'},
        ACCOUNTANT: {'read', 'list', 'retrieve', 'update', 'partial_update'},
    }


class DashboardPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and (is_admin(request.user) or has_any_role(request.user, {MANAGER, TEACHER, ACCOUNTANT}))


class ReportsPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and (is_admin(request.user) or has_any_role(request.user, {MANAGER, ACCOUNTANT}))


class ExcelImportPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and (is_admin(request.user) or has_role(request.user, ACCOUNTANT))


class ExportPermission(BasePermission):
    def has_permission(self, request, view):
        if not is_authenticated(request.user):
            return False
        if is_admin(request.user):
            return True
        export_type = getattr(view, 'export_type', '')
        if has_role(request.user, ACCOUNTANT):
            return export_type in {'subscriptions', 'finance', 'report-summary'}
        if has_role(request.user, MANAGER):
            return export_type in {
                'clients',
                'subscriptions',
                'visits',
                'trials',
                'master-classes',
                'groups',
                'lessons',
                'report-summary',
            }
        if has_role(request.user, TEACHER):
            return export_type in {'visits', 'lessons'}
        return False


class BackupPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and is_admin(request.user)


class ChatPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create'},
        TEACHER: {'read', 'list', 'retrieve', 'create'},
        ACCOUNTANT: {'read', 'list', 'retrieve', 'create'},
    }


class EducationPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {
            'read',
            'list',
            'retrieve',
            'create',
            'update',
            'partial_update',
            'destroy',
            'generate_lessons',
            'attendance',
            'cancel',
        },
        TEACHER: {'read', 'list', 'retrieve', 'attendance'},
        ACCOUNTANT: {'read', 'list', 'retrieve'},
    }

    def has_object_permission(self, request, view, obj):
        if is_admin(request.user):
            return True
        action = getattr(view, 'action', None)

        if has_role(request.user, MANAGER):
            return True

        if has_role(request.user, ACCOUNTANT):
            return request.method in SAFE_METHODS

        if has_role(request.user, TEACHER):
            if action not in {'retrieve', 'attendance'} and request.method not in SAFE_METHODS:
                return False
            teacher_id = request.user.id
            if hasattr(obj, 'teacher_id'):
                return obj.teacher_id == teacher_id
            if hasattr(obj, 'group') and obj.group:
                return obj.group.teacher_id == teacher_id
            if hasattr(obj, 'schedule_slot') and obj.schedule_slot:
                return obj.schedule_slot.teacher_id == teacher_id
        return False
