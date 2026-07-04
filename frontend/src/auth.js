export const ACCESS_TOKEN_KEY = 'access';
export const REFRESH_TOKEN_KEY = 'refresh';
export const USER_KEY = 'user';

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TEACHER: 'teacher',
  ACCOUNTANT: 'accountant',
};

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getRole(user = getStoredUser()) {
  return user?.role || '';
}

export function hasRole(user, roles) {
  return roles.includes(getRole(user));
}

export function isAdmin(user = getStoredUser()) {
  return getRole(user) === ROLES.ADMIN;
}

export function canAccessNavItem(item, user = getStoredUser()) {
  const role = getRole(user);
  return role === ROLES.ADMIN || !item.roles || item.roles.includes(role);
}

export function canAccessPath(pathname, user = getStoredUser()) {
  const role = getRole(user);
  if (role === ROLES.ADMIN || pathname === '/' || pathname.startsWith('/clients/')) return true;

  if (role === ROLES.MANAGER) {
    return ['/clients', '/subscriptions', '/trials', '/master-classes', '/tasks', '/dictionaries', '/groups', '/schedule', '/finance', '/chat', '/settings'].includes(pathname)
      || pathname.startsWith('/lessons/');
  }

  if (role === ROLES.TEACHER) {
    return ['/clients', '/subscriptions', '/visits', '/trials', '/master-classes', '/tasks', '/groups', '/schedule', '/chat'].includes(pathname)
      || pathname.startsWith('/lessons/');
  }

  if (role === ROLES.ACCOUNTANT) {
    return ['/clients', '/subscriptions', '/visits', '/trials', '/master-classes', '/finance', '/reports', '/chat', '/settings'].includes(pathname);
  }

  return false;
}

export function canDeleteDangerous(user = getStoredUser()) {
  return isAdmin(user);
}

export function canManageClients(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
}

export function canManageSubscriptions(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT]);
}

export function canManageSales(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
}

export function canManageVisits(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.TEACHER]);
}

export function canManageFinance(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.ACCOUNTANT]);
}

export function canImportExcel(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.ACCOUNTANT]);
}

export function canEditSettingsPrices(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.ACCOUNTANT]);
}

export function canEditStudioSettings(user = getStoredUser()) {
  return isAdmin(user);
}

export function canCreateTasks(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
}

export function canDeleteTask(task, user = getStoredUser()) {
  return isAdmin(user) || (getRole(user) === ROLES.MANAGER && (!task.assigned_to || task.assigned_to === user?.id));
}
