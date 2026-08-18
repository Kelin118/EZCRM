import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import api from '../../api/axios.js';
import { canManageClients, getStoredUser } from '../../auth.js';
import useClients from '../../hooks/useClients.js';
import QuickClientCreateModal from './QuickClientCreateModal.jsx';

function toList(data) {
  return Array.isArray(data) ? data : data?.results || [];
}

const normalizeText = (value) => String(value || '').trim().toLocaleLowerCase('ru-RU');
const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

function primaryName(client) {
  return client.full_name || client.client_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.display_name?.split(' · ')[0] || `Клиент #${client.id}`;
}

export function getClientDisplayName(client) {
  const name = client.display_name || primaryName(client);
  return client.display_name ? name : [name, client.parent_name, client.phone].filter(Boolean).join(' · ');
}

function optionToClient(option) {
  if (!option || option.value === '') return null;
  return {
    id: option.value,
    full_name: option.label?.split(' · ')[0] || option.label,
    display_name: option.label,
  };
}

function phoneVariants(client) {
  const digits = normalizeDigits(client.phone || client.display_name || '');
  const variants = new Set([digits]);
  if (digits.startsWith('7')) variants.add(`8${digits.slice(1)}`);
  if (digits.startsWith('8')) variants.add(`7${digits.slice(1)}`);
  if (digits.length >= 10) variants.add(digits.slice(-10));
  if (digits.length >= 4) variants.add(digits.slice(-4));
  return Array.from(variants).filter(Boolean);
}

function rankClient(client, query) {
  const textQuery = normalizeText(query);
  const digitQuery = normalizeDigits(query);
  if (!textQuery && !digitQuery) return 100;

  const name = normalizeText(primaryName(client));
  const display = normalizeText(client.display_name);
  const parent = normalizeText(client.parent_name);
  const phones = phoneVariants(client);

  if (digitQuery) {
    if (phones.some((phone) => phone === digitQuery)) return 1;
    if (phones.some((phone) => phone.startsWith(digitQuery))) return 2;
  }
  if (name === textQuery || display === textQuery) return 3;
  if (name.startsWith(textQuery) || display.startsWith(textQuery)) return 4;
  if (name.includes(textQuery) || display.includes(textQuery)) return 5;
  if (parent.includes(textQuery)) return 6;
  if (digitQuery && phones.some((phone) => phone.includes(digitQuery))) return 7;
  return Infinity;
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
  placeholder = 'Начните вводить имя или телефон',
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [loadedClients, setLoadedClients] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const { clients: sharedClients, addClientToCache } = useClients();
  const user = getStoredUser();
  const canCreate = canManageClients(user);

  useEffect(() => {
    if (clients || options || sharedClients.length) return undefined;
    let mounted = true;
    api.get('clients/options/').then(({ data }) => {
      if (mounted) setLoadedClients(toList(data));
    }).catch(() => {
      if (mounted) setLoadedClients([]);
    });
    return () => { mounted = false; };
  }, [clients, options, sharedClients]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, []);

  const baseClients = useMemo(() => {
    const source = clients
      ? [...sharedClients, ...clients]
      : options
        ? [...sharedClients, ...options.map(optionToClient).filter(Boolean)]
        : (sharedClients.length ? sharedClients : loadedClients);
    const byId = new Map();
    source.forEach((client) => {
      if (client?.id !== undefined && client?.id !== null) byId.set(String(client.id), { ...client, id: String(client.id) });
    });
    return Array.from(byId.values());
  }, [clients, options, loadedClients, sharedClients]);

  const selectedClient = useMemo(
    () => baseClients.find((client) => String(client.id) === String(value || '')) || null,
    [baseClients, value],
  );

  const rankedClients = useMemo(() => {
    return baseClients
      .map((client) => ({ client, rank: rankClient(client, query) }))
      .filter((item) => item.rank !== Infinity)
      .sort((left, right) => left.rank - right.rank || primaryName(left.client).localeCompare(primaryName(right.client), 'ru'))
      .slice(0, 15)
      .map((item) => item.client);
  }, [baseClients, query]);

  const shownValue = open ? query : (selectedClient ? getClientDisplayName(selectedClient) : query);

  const selectClient = (client) => {
    onChange(String(client.id), client);
    setQuery('');
    setOpen(false);
    setHighlightedIndex(0);
  };

  const clearSelection = () => {
    onChange('');
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const openCreate = () => {
    if (!canCreate) return;
    setOpen(false);
    setModalOpen(true);
  };

  const handleCreated = (client) => {
    const nextClient = { ...client, id: String(client.id) };
    addClientToCache(nextClient);
    onChange(String(nextClient.id), nextClient);
    onClientCreated?.(nextClient);
    setQuery('');
    setModalOpen(false);
  };

  const totalRows = rankedClients.length + (canCreate ? 1 : 0);

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((index) => (index + 1) % Math.max(totalRows, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((index) => (index <= 0 ? Math.max(totalRows - 1, 0) : index - 1));
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (rankedClients[highlightedIndex]) selectClient(rankedClients[highlightedIndex]);
      else if (canCreate) openCreate();
    }
  };

  return (
    <div ref={rootRef} className="relative grid gap-1.5 text-sm font-semibold text-slate-700">
      {label && <span>{label}</span>}
      <div className={`flex min-h-11 items-center gap-2 rounded-2xl border bg-white px-3 py-2 text-sm transition ${error ? 'border-red-300' : 'border-slate-200 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10'} ${disabled ? 'bg-slate-50 text-slate-400' : ''}`}>
        <Search size={17} className="shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={shownValue}
          disabled={disabled}
          required={required && !value}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setHighlightedIndex(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {value && !disabled && (
          <button type="button" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={clearSelection} aria-label="Очистить выбор" title="Очистить выбор">
            <X size={16} />
          </button>
        )}
      </div>
      {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
          {rankedClients.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-500">Клиенты не найдены</p>}
          {rankedClients.map((client, index) => (
            <button
              key={client.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectClient(client)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${highlightedIndex === index ? 'bg-brand/10' : 'hover:bg-slate-50'}`}
            >
              <span className="block font-semibold text-slate-900">{primaryName(client)}</span>
              {client.parent_name && <span className="block text-xs text-slate-500">Родитель: {client.parent_name}</span>}
              {client.phone && <span className="block text-xs text-slate-500">{client.phone}</span>}
              {client.branch_name && <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Филиал: {client.branch_name}</span>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(rankedClients.length)}
              onClick={openCreate}
              className={`mt-1 w-full rounded-xl border border-dashed border-brand/30 px-3 py-2.5 text-left font-bold text-brand transition ${highlightedIndex === rankedClients.length ? 'bg-brand/10' : 'hover:bg-brand/5'}`}
            >
              + Добавить нового клиента
            </button>
          )}
        </div>
      )}
      <QuickClientCreateModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
