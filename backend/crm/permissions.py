from rest_framework.permissions import SAFE_METHODS, BasePermission


ADMIN = 'admin'
MANAGER = 'manager'
TEACHER = 'teacher'
ACCOUNTANT = 'accountant'


def role(user):
    return getattr(user, 'role', None)


def is_admin(user):
    return role(user) == ADMIN or getattr(user, 'is_superuser', False)


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
        allowed_actions = self.allowed_by_role.get(role(request.user), set())
        return action in allowed_actions or (request.method in SAFE_METHODS and 'read' in allowed_actions)

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


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
        MANAGER: {'read', 'list', 'retrieve'},
        TEACHER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
        ACCOUNTANT: {'read', 'list', 'retrieve'},
    }


class TrialPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create', 'update', 'partial_update'},
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
        user_role = role(request.user)
        action = getattr(view, 'action', None)

        if user_role == MANAGER:
            if action == 'destroy':
                return obj.assigned_to_id == request.user.id
            return True

        if user_role == TEACHER:
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
        return is_authenticated(request.user) and (is_admin(request.user) or role(request.user) in {MANAGER, TEACHER, ACCOUNTANT})


class ReportsPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and (is_admin(request.user) or role(request.user) in {MANAGER, ACCOUNTANT})


class ExcelImportPermission(BasePermission):
    def has_permission(self, request, view):
        return is_authenticated(request.user) and (is_admin(request.user) or role(request.user) == ACCOUNTANT)


class ChatPermission(RolePermission):
    allowed_by_role = {
        MANAGER: {'read', 'list', 'retrieve', 'create'},
        TEACHER: {'read', 'list', 'retrieve', 'create'},
        ACCOUNTANT: {'read', 'list', 'retrieve', 'create'},
    }
