import { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';

let clientCache = [];
let loaded = false;
let pendingRequest = null;
const listeners = new Set();

function publish(clients) {
  clientCache = clients;
  loaded = true;
  listeners.forEach((listener) => listener(clientCache));
}

function mergeClient(client) {
  const id = String(client.id);
  publish([client, ...clientCache.filter((item) => String(item.id) !== id)]);
}

async function fetchClients() {
  if (!pendingRequest) {
    pendingRequest = api.get('clients/options/')
      .then(({ data }) => {
        const clients = Array.isArray(data) ? data : data?.results || [];
        publish(clients);
        return clients;
      })
      .finally(() => {
        pendingRequest = null;
      });
  }
  return pendingRequest;
}

function clientLabel(client) {
  const name = client.display_name || client.full_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || `Клиент #${client.id}`;
  if (client.display_name) return client.display_name;
  return [name, client.parent_name, client.phone].filter(Boolean).join(' · ');
}

export default function useClients() {
  const [clients, setClients] = useState(clientCache);
  const [loading, setLoading] = useState(!loaded);

  useEffect(() => {
    listeners.add(setClients);
    if (!loaded) {
      fetchClients().catch(() => publish([])).finally(() => setLoading(false));
    } else {
      setClients(clientCache);
      setLoading(false);
    }
    return () => listeners.delete(setClients);
  }, []);

  const refreshClients = useCallback(async () => {
    setLoading(true);
    try {
      return await fetchClients();
    } finally {
      setLoading(false);
    }
  }, []);

  const addClientToCache = useCallback((client) => {
    mergeClient(client);
  }, []);

  const getClientById = useCallback(
    (id) => clients.find((client) => String(client.id) === String(id)) || null,
    [clients],
  );

  const clientOptions = useMemo(
    () => clients.map((client) => ({ value: String(client.id), label: clientLabel(client) })),
    [clients],
  );

  return {
    clients,
    clientOptions,
    loading,
    refreshClients,
    addClientToCache,
    getClientById,
  };
}
