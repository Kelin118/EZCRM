from .models import User


ROLE_LEVELS = {
    User.Role.TEACHER: 10,
    User.Role.ACCOUNTANT: 20,
    User.Role.MANAGER: 50,
    User.Role.ADMIN: 100,
}

ADMIN_LEVEL = ROLE_LEVELS[User.Role.ADMIN]
MANAGER_LEVEL = ROLE_LEVELS[User.Role.MANAGER]
KNOWN_ROLES = set(ROLE_LEVELS)


def normalized_role_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        return None

    roles = []
    for item in value:
        role_value = str(item).strip()
        if not role_value:
            continue
        if role_value not in KNOWN_ROLES:
            return None
        if role_value not in roles:
            roles.append(role_value)
    return roles


def user_roles(user):
    if not user:
        return []
    if getattr(user, 'is_superuser', False):
        roles = [User.Role.ADMIN]
        raw_roles = getattr(user, 'roles', [])
        if isinstance(raw_roles, list):
            roles.extend(raw_roles)
        elif getattr(user, 'role', None):
            roles.append(user.role)
        return list(dict.fromkeys(role for role in roles if role in KNOWN_ROLES))
    if hasattr(user, 'get_roles'):
        return user.get_roles()
    user_role = getattr(user, 'role', None)
    return [user_role] if user_role else []


def effective_role_level_from_roles(roles):
    roles = normalized_role_list(roles)
    if roles is None or not roles:
        return None
    levels = [ROLE_LEVELS.get(role) for role in roles]
    if any(level is None for level in levels):
        return None
    return max(levels)


def effective_role_level(user):
    if getattr(user, 'is_superuser', False):
        return ADMIN_LEVEL
    return effective_role_level_from_roles(user_roles(user))


def is_admin_level(user):
    level = effective_role_level(user)
    return level is not None and level >= ADMIN_LEVEL


def is_manager_level(user):
    level = effective_role_level(user)
    return level is not None and level >= MANAGER_LEVEL


def can_assign_roles(actor, roles):
    actor_level = effective_role_level(actor)
    target_level = effective_role_level_from_roles(roles)
    if actor_level is None or target_level is None:
        return False
    if actor_level >= ADMIN_LEVEL:
        return True
    if actor_level >= MANAGER_LEVEL:
        return target_level <= MANAGER_LEVEL
    return False


def can_manage_user(actor, target_user):
    actor_level = effective_role_level(actor)
    target_level = effective_role_level(target_user)
    if actor_level is None or target_level is None:
        return False
    if actor_level >= ADMIN_LEVEL:
        return True
    if actor_level >= MANAGER_LEVEL:
        return not getattr(target_user, 'is_superuser', False) and target_level <= MANAGER_LEVEL
    return False


def manageable_by_manager(user):
    return can_manage_user(_ManagerActor(), user)


class _ManagerActor:
    is_superuser = False
    role = User.Role.MANAGER
    roles = [User.Role.MANAGER]

    def get_roles(self):
        return self.roles
