import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import useSharedClients from '../hooks/useClients.js';

export function toList(data) {
  return Array.isArray(data) ? data : data?.results || [];
}

export function useLookup(endpoint, params = {}, options = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(endpoint));
  const paramsKey = JSON.stringify(params || {});

  useEffect(() => {
    if (!endpoint || options.enabled === false) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    setLoading(true);
    api
      .get(endpoint, { params })
      .then(({ data }) => {
        if (mounted) setItems(toList(data));
      })
      .catch((error) => {
        if (!mounted) return;
        if (options.fallbackOnForbidden && error.response?.status === 403) {
          setItems(options.fallbackOnForbidden());
          return;
        }
        setItems([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [endpoint, paramsKey, options.enabled]);

  return { items, loading };
}

export function useClients() {
  const { clients, loading, refreshClients, addClientToCache, getClientById } = useSharedClients();
  return {
    items: clients,
    loading,
    refreshClients,
    addClientToCache,
    getClientById,
  };
}

export function useSubjects() {
  return useLookup('subjects/', { is_active: '1' });
}

export function useRooms() {
  return useLookup('rooms/', { is_active: '1' });
}

export function useStudyGroups() {
  return useLookup('study-groups/');
}

export function useSubscriptions(params = {}) {
  return useLookup('subscriptions/', params);
}

export function useEmployees(roles = []) {
  const params = { active: '1' };
  if (roles.length === 1) params.role = roles[0];
  return useLookup('users/staff-options/', params);
}

export function clientLabel(client) {
  if (client.display_name) return client.display_name;
  const name = client.client_name || client.full_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || `Клиент #${client.id}`;
  return [name, client.parent_name, client.phone].filter(Boolean).join(' · ');
}

export function employeeLabel(employee) {
  const name = employee.display_name || employee.full_name || employee.username || `Сотрудник #${employee.id}`;
  return name;
}

function employeeHasRole(employee, roleName) {
  const employeeRoles = Array.isArray(employee.roles) && employee.roles.length
    ? employee.roles
    : [employee.role].filter(Boolean);
  return employeeRoles.includes(roleName);
}

export function subscriptionLabel(subscription) {
  const title = subscription.subscription_title || subscription.title || `Абонемент #${subscription.id}`;
  const left = subscription.lessons_left ?? subscription.remaining_visits;
  const total = subscription.lessons_total ?? subscription.total_visits;
  const lessons = left !== undefined && total !== undefined ? `${left}/${total}` : '';
  return [title, lessons, subscription.status].filter(Boolean).join(' · ');
}

export function subjectLabel(subject) {
  return subject.name || `Предмет #${subject.id}`;
}

export function roomLabel(room) {
  return room.name || `Кабинет #${room.id}`;
}

export function groupLabel(group) {
  return group.name || `Группа #${group.id}`;
}

export function useClientOptions() {
  const shared = useSharedClients();
  return {
    clients: shared.clients,
    clientOptions: shared.clientOptions,
    loadingClients: shared.loading,
    refreshClients: shared.refreshClients,
    addClientToCache: shared.addClientToCache,
    getClientById: shared.getClientById,
  };
}

export function useEmployeeOptions(roles = []) {
  const { items, loading } = useEmployees(roles);
  const options = useMemo(
    () => items
      .filter((employee) => !roles.length || roles.some((roleName) => employeeHasRole(employee, roleName)))
      .map((employee) => ({ value: String(employee.id), label: employeeLabel(employee) })),
    [items, roles.join('|')],
  );
  return { employees: items, employeeOptions: options, loadingEmployees: loading };
}

export function useSubjectOptions() {
  const { items, loading } = useSubjects();
  const options = useMemo(() => items.map((subject) => ({ value: String(subject.id), label: subjectLabel(subject) })), [items]);
  return { subjects: items, subjectOptions: options, loadingSubjects: loading };
}

export function useRoomOptions() {
  const { items, loading } = useRooms();
  const options = useMemo(() => items.map((room) => ({ value: String(room.id), label: roomLabel(room) })), [items]);
  return { rooms: items, roomOptions: options, loadingRooms: loading };
}

export function useStudyGroupOptions() {
  const { items, loading } = useStudyGroups();
  const options = useMemo(() => items.map((group) => ({ value: String(group.id), label: groupLabel(group) })), [items]);
  return { groups: items, groupOptions: options, loadingGroups: loading };
}
