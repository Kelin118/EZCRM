import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';

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
  return useLookup('clients/');
}

export function useEmployees(roles = []) {
  const params = { active: '1' };
  if (roles.length === 1) params.role = roles[0];
  return useLookup('users/staff-options/', params);
}

export function clientLabel(client) {
  const name = client.client_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.full_name || `Клиент #${client.id}`;
  return [name, client.phone].filter(Boolean).join(' · ');
}

export function employeeLabel(employee) {
  const name = employee.display_name || employee.full_name || employee.username || `Сотрудник #${employee.id}`;
  return employee.role ? `${name} · ${employee.role}` : name;
}

export function subscriptionLabel(subscription) {
  const title = subscription.subscription_title || subscription.title || `Абонемент #${subscription.id}`;
  const left = subscription.lessons_left ?? subscription.remaining_visits;
  const total = subscription.lessons_total ?? subscription.total_visits;
  const lessons = left !== undefined && total !== undefined ? `${left}/${total}` : '';
  return [title, lessons, subscription.status].filter(Boolean).join(' · ');
}

export function useClientOptions() {
  const { items, loading } = useClients();
  const options = useMemo(() => items.map((client) => ({ value: String(client.id), label: clientLabel(client) })), [items]);
  return { clients: items, clientOptions: options, loadingClients: loading };
}

export function useEmployeeOptions(roles = []) {
  const { items, loading } = useEmployees(roles);
  const options = useMemo(
    () => items
      .filter((employee) => !roles.length || roles.includes(employee.role))
      .map((employee) => ({ value: String(employee.id), label: employeeLabel(employee) })),
    [items, roles.join('|')],
  );
  return { employees: items, employeeOptions: options, loadingEmployees: loading };
}
