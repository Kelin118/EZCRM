import { Edit, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Table from '../components/ui/Table.jsx';

export const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
export const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
export const dateOnly = (value) => (value ? new Date(value).toLocaleDateString('ru-RU') : '—');

const nullableFields = new Set([
  'assigned_to',
  'birth_date',
  'client',
  'due_at',
  'end_date',
  'manager',
  'paid_at',
  'payment_date',
  'scheduled_at',
  'starts_at',
  'subscription',
  'teacher',
]);

const readOnlyFields = new Set(['id', 'created_at', 'updated_at', 'sender', 'sender_name']);

export function normalizePayload(payload) {
  const normalized = {};

  Object.entries(payload).forEach(([key, value]) => {
    if (readOnlyFields.has(key)) return;

    if (value === '' && nullableFields.has(key)) {
      normalized[key] = null;
      return;
    }

    if (typeof value === 'string' && value.includes('T') && value.endsWith('Z')) {
      normalized[key] = value.slice(0, 16);
      return;
    }

    normalized[key] = value;
  });

  return normalized;
}

export function PageHeader({ title, actionLabel, onAction, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        {children && <div className="mt-2 flex flex-wrap gap-2">{children}</div>}
      </div>
      {onAction && (
        <Button onClick={onAction}>
          <Plus size={17} />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function Filters({ children }) {
  return <div className="mb-4 grid gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm md:grid-cols-4">{children}</div>;
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Actions({ onEdit, onDelete }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" className="h-9 w-9 p-0" onClick={onEdit} aria-label="Редактировать">
        <Edit size={16} />
      </Button>
      <Button variant="danger" className="h-9 w-9 p-0" onClick={onDelete} aria-label="Удалить">
        <Trash2 size={16} />
      </Button>
    </div>
  );
}

export function CrudModal({ title, open, onClose, fields, form, setForm, onSubmit, saving }) {
  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => {
          if (field.type === 'select') {
            return (
              <SelectField
                key={field.name}
                label={field.label}
                value={form[field.name] ?? ''}
                onChange={(value) => setForm({ ...form, [field.name]: value })}
                options={field.options}
              />
            );
          }
          if (field.type === 'textarea') {
            return (
              <label key={field.name} className="grid gap-1.5 text-sm font-medium text-slate-700 md:col-span-2">
                {field.label}
                <textarea
                  className="min-h-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  value={form[field.name] ?? ''}
                  onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
                />
              </label>
            );
          }
          return (
            <Input
              key={field.name}
              label={field.label}
              type={field.type || 'text'}
              value={form[field.name] ?? ''}
              onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
            />
          );
        })}
      </div>
    </Modal>
  );
}

export function useCrudResource(endpoint, initialFilters = {}) {
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const params = useMemo(() => {
    const clean = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) clean[key] = value;
    });
    return clean;
  }, [filters]);

  const load = async () => {
    setLoading(true);
    const { data } = await api.get(endpoint, { params });
    setItems(Array.isArray(data) ? data : data.results || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [endpoint, params]);

  const save = async (payload) => {
    setSaving(true);
    const normalizedPayload = normalizePayload(payload);
    if (editing?.id) {
      await api.patch(`${endpoint}${editing.id}/`, normalizedPayload);
    } else {
      await api.post(endpoint, normalizedPayload);
    }
    setSaving(false);
    setModalOpen(false);
    setEditing(null);
    await load();
  };

  const remove = async (id) => {
    if (!window.confirm('Удалить запись?')) return;
    await api.delete(`${endpoint}${id}/`);
    await load();
  };

  return {
    items,
    loading,
    filters,
    setFilters,
    saving,
    editing,
    setEditing,
    modalOpen,
    setModalOpen,
    save,
    remove,
    reload: load,
  };
}

export { Badge, Button, Input, Table };
