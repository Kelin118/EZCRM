import { useEffect, useMemo, useState } from 'react';

import api from '../../api/axios.js';
import { canManageClients, getStoredUser } from '../../auth.js';
import QuickClientCreateModal from './QuickClientCreateModal.jsx';

function toList(data) {
  return Array.isArray(data) ? data : data?.results || [];
}

export function getClientDisplayName(client) {
  const name = client.display_name || client.full_name || client.client_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || `Клиент #${client.id}`;
  return [name, client.phone].filter(Boolean).join(' · ');
}

function optionToClient(option) {
  if (!option || option.value === '') return null;
  return {
    id: option.value,
    display_name: option.label,
  };
}

export default function ClientSelectWithCreate({
  value,
  onChange,
  clients,
  options,
  onClientCreated,
  label = 'Клиент',
  required = false,
  disabled = false,
  error = '',
  placeholder = 'Выберите клиента',
}) {
  const [loadedClients, setLoadedClients] = useState([]);
  const [createdClients, setCreatedClients] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const user = getStoredUser();
  const canCreate = canManageClients(user);

  useEffect(() => {
    if (clients || options) return undefined;
    let mounted = true;
    api.get('clients/').then(({ data }) => {
      if (mounted) setLoadedClients(toList(data));
    }).catch(() => {
      if (mounted) setLoadedClients([]);
    });
    return () => {
      mounted = false;
    };
  }, [clients, options]);

  const baseClients = useMemo(() => {
    if (clients) return clients;
    if (options) return options.map(optionToClient).filter(Boolean);
    return loadedClients;
  }, [clients, options, loadedClients]);

  const clientOptions = useMemo(() => {
    const byId = new Map();
    [...createdClients, ...baseClients].forEach((client) => {
      if (client?.id !== undefined && client?.id !== null) byId.set(String(client.id), client);
    });
    return Array.from(byId.values()).map((client) => ({ value: String(client.id), label: getClientDisplayName(client) }));
  }, [createdClients, baseClients]);

  const handleCreated = (client) => {
    const nextClient = { ...client, id: String(client.id) };
    setCreatedClients((current) => [nextClient, ...current.filter((item) => String(item.id) !== String(nextClient.id))]);
    onChange(String(nextClient.id), nextClient);
    onClientCreated?.(nextClient);
  };

  const handleChange = (event) => {
    const nextValue = event.target.value;
    if (nextValue === '__create_client__') {
      setModalOpen(true);
      return;
    }
    onChange(nextValue);
  };

  return (
    <div className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label && <span>{label}</span>}
      <select
        value={value ?? ''}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <option value="">{placeholder}</option>
        {clientOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {canCreate && <option disabled>────────────────────</option>}
        {canCreate && <option value="__create_client__">+ Добавить клиента</option>}
      </select>
      {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      <QuickClientCreateModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
