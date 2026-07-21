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
  return getUserRoles(user)[0] || '';
}

export function getUserRoles(user = getStoredUser()) {
  if (!user) return [];
  const values = [];
  if (user.is_superuser) values.push(ROLES.ADMIN);
  if (Array.isArray(user.roles)) values.push(...user.roles);
  else if (typeof user.roles === 'string' && user.roles) values.push(user.roles);
  if (user.role) values.push(user.role);
  return [...new Set(values.filter(Boolean))];
}

export function hasRole(user, roleName) {
  if (Array.isArray(roleName)) return hasAnyRole(user, roleName);
  return getUserRoles(user).includes(roleName);
}

export function hasAnyRole(user, roles) {
  const roleList = Array.isArray(roles) ? roles : Array.from(arguments).slice(1);
  const userRoles = getUserRoles(user);
  return userRoles.includes(ROLES.ADMIN) || roleList.some((roleName) => userRoles.includes(roleName));
}

export function isAdmin(user = getStoredUser()) {
  return hasRole(user, ROLES.ADMIN);
}

export function canAccessNavItem(item, user = getStoredUser()) {
  return isAdmin(user) || !item.roles || hasAnyRole(user, item.roles);
}

export function canAccessPath(pathname, user = getStoredUser()) {
  if (isAdmin(user) || pathname === '/' || pathname.startsWith('/clients/')) return true;

  const allowedPaths = new Set();
  if (hasRole(user, ROLES.MANAGER)) {
    ['/clients', '/subscriptions', '/visits', '/trials', '/master-classes', '/certificates', '/tasks', '/dictionaries', '/export', '/groups', '/schedule', '/finance', '/employees', '/chat', '/settings'].forEach((path) => allowedPaths.add(path));
  }

  if (hasRole(user, ROLES.TEACHER)) {
    ['/clients', '/subscriptions', '/visits', '/trials', '/master-classes', '/tasks', '/groups', '/schedule', '/chat'].forEach((path) => allowedPaths.add(path));
  }

  if (hasRole(user, ROLES.ACCOUNTANT)) {
    ['/clients', '/subscriptions', '/visits', '/trials', '/master-classes', '/certificates', '/finance', '/reports', '/export', '/chat', '/settings'].forEach((path) => allowedPaths.add(path));
  }

  return allowedPaths.has(pathname) || pathname.startsWith('/lessons/');
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
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.TEACHER]);
}

export function canManageFinance(user = getStoredUser()) {
  return hasRole(user, [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT]);
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
  return isAdmin(user) || (hasRole(user, ROLES.MANAGER) && (!task.assigned_to || task.assigned_to === user?.id));
}

export const ROLE_LEVELS = {
  [ROLES.TEACHER]: 10,
  [ROLES.ACCOUNTANT]: 20,
  [ROLES.MANAGER]: 50,
  [ROLES.ADMIN]: 100,
};

export function getEffectiveRoleLevel(user = getStoredUser()) {
  const userRoles = getUserRoles(user);
  if (!userRoles.length) return null;
  const levels = userRoles.map((roleName) => ROLE_LEVELS[roleName]);
  if (levels.some((level) => level === undefined)) return null;
  return Math.max(...levels);
}

export function canAssignRoleSet(roleSet, user = getStoredUser()) {
  const actorLevel = getEffectiveRoleLevel(user);
  const levels = (roleSet || []).map((roleName) => ROLE_LEVELS[roleName]);
  if (actorLevel === null || !levels.length || levels.some((level) => level === undefined)) return false;
  if (actorLevel >= ROLE_LEVELS[ROLES.ADMIN]) return true;
  if (actorLevel >= ROLE_LEVELS[ROLES.MANAGER]) return Math.max(...levels) <= ROLE_LEVELS[ROLES.MANAGER];
  return false;
}

export function canManageEmployee(employee, user = getStoredUser()) {
  if (isAdmin(user)) return true;
  if (!hasRole(user, ROLES.MANAGER) || employee?.is_superuser) return false;
  const employeeLevel = getEffectiveRoleLevel(employee);
  return employeeLevel !== null && employeeLevel <= ROLE_LEVELS[ROLES.MANAGER];
}
