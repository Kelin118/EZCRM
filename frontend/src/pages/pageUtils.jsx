import { ChevronDown, Pencil, Plus, Save, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Children, useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import ClientSelectWithCreate from '../components/clients/ClientSelectWithCreate.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Table from '../components/ui/Table.jsx';
import { formatDateTimeLocal, normalizeDateForInput, normalizeTimeForApi, normalizeTimeForInput, serializeDateTimeLocal } from '../utils/dateTime.js';

export const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
export const dateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
export const dateOnly = (value) => {
  const dateValue = normalizeDateForInput(value);
  if (!dateValue) return '—';
  const [year, month, day] = dateValue.split('-');
  return [day, month, year].filter(Boolean).join('.');
};

const nullableFields = new Set([
  'assigned_to',
  'birth_date',
  'capacity',
  'client',
  'due_at',
  'end_date',
  'group',
  'joined_at',
  'left_at',
  'lesson',
  'lesson_date',
  'manager',
  'paid_at',
  'payment_date',
  'purchase_date',
  'room',
  'schedule_slot',
  'scheduled_at',
  'starts_at',
  'subject',
  'subscription',
  'teacher',
]);

const readOnlyFields = new Set([
  'id',
  'created_at',
  'updated_at',
  'sender',
  'sender_name',
  'client_name',
  'created_by',
  'created_by_name',
  'manager_name',
  'teacher_name',
  'assigned_to_name',
  'client_parent_name',
  'client_phone',
  'group_name',
  'subject_name',
  'room_name',
  'weekday_display',
  'status_display',
  'students_count',
  'visits_count',
  'attended_count',
  'missed_count',
  'subscription_title',
  'lesson_title',
  'used_lessons',
  'lessons_left',
  'lessons_total',
  'progress_percent',
  'finance_transaction',
  'lesson_deducted',
  'manager_work_schedule',
  'amount_due',
  'paid_total',
  'remaining_amount',
  'overpaid_amount',
  'payment_status',
  'payments',
  'payment_method_name',
]);

const timeFields = new Set(['start_time', 'end_time']);
const dateFields = new Set([
  'birth_date',
  'date_from',
  'date_to',
  'end_date',
  'joined_at',
  'left_at',
  'lesson_date',
  'payment_date',
  'purchase_date',
  'start_date',
]);
const dateTimeFields = new Set(['due_at', 'paid_at', 'scheduled_at', 'starts_at', 'visited_at']);
const relationIdFields = new Set([
  'assigned_to',
  'branch',
  'client',
  'created_by',
  'finance_transaction',
  'group',
  'lesson',
  'manager',
  'payment_method',
  'room',
  'schedule_slot',
  'service',
  'subject',
  'subscription',
  'teacher',
]);

function normalizeFormValue(key, value) {
  if (value === null || value === undefined) return '';
  if (timeFields.has(key)) return normalizeTimeForInput(value);
  if (dateFields.has(key)) return normalizeDateForInput(value);
  if (dateTimeFields.has(key)) return formatDateTimeLocal(value);
  if (relationIdFields.has(key)) return value === '' ? '' : String(value);
  if (key === 'schedule_days' || key === 'roles') return Array.isArray(value) ? [...value] : [];
  if (key === 'addons') {
    return (Array.isArray(value) ? value : []).map((addon) => ({
      ...addon,
      catalog_item: addon.catalog_item !== undefined && addon.catalog_item !== null ? String(addon.catalog_item) : '',
      quantity: addon.quantity ?? 1,
    }));
  }
  return value;
}

export function normalizeItemForForm(item = {}) {
  return Object.fromEntries(Object.entries(item || {}).map(([key, value]) => [key, normalizeFormValue(key, value)]));
}

export function normalizePayload(payload) {
  const normalized = {};

  Object.entries(payload).forEach(([key, value]) => {
    if (readOnlyFields.has(key)) return;

    if (value === '' && nullableFields.has(key)) {
      normalized[key] = null;
      return;
    }

    if (timeFields.has(key)) {
      normalized[key] = normalizeTimeForApi(value);
      return;
    }

    if (dateFields.has(key)) {
      normalized[key] = normalizeDateForInput(value) || null;
      return;
    }

    if (dateTimeFields.has(key)) {
      normalized[key] = serializeDateTimeLocal(value);
      return;
    }

    normalized[key] = value;
  });

  return normalized;
}

export function getApiErrorMessage(error) {
  const data = error.response?.data;
  if (!data) return 'Не удалось выполнить действие.';
  if (typeof data === 'string') return data;
  if (data.detail) return data.detail;

  const firstKey = Object.keys(data)[0];
  const firstValue = data[firstKey];
  if (Array.isArray(firstValue)) return `${firstKey}: ${firstValue[0]}`;
  if (firstValue && typeof firstValue === 'object') return `${firstKey}: ${JSON.stringify(firstValue)}`;
  return firstValue ? `${firstKey}: ${firstValue}` : 'Проверьте заполнение формы.';
}

export function showApiError(error) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: getApiErrorMessage(error) }));
}

export function PageHeader({ title, description, actionLabel, onAction, secondaryActions, tabs, children }) {
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold text-slate-900 text-pretty">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
        {tabs && <div className="mt-3 max-w-full overflow-x-auto pb-1 scrollbar-thin">{tabs}</div>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
      {(secondaryActions || onAction) && (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {secondaryActions}
          {onAction && (
            <Button onClick={onAction}>
              <Plus size={17} aria-hidden="true" />
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function Filters({ children, initiallyExpanded = false }) {
  const items = Children.toArray(children).filter(Boolean);
  const hasMany = items.length > 4;
  const [expanded, setExpanded] = useState(initiallyExpanded || !hasMany);
  const visibleItems = expanded ? items : items.slice(0, 4);

  useEffect(() => {
    if (!hasMany) setExpanded(true);
  }, [hasMany]);

  return (
    <section className="mb-5 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {visibleItems}
      </div>
      {hasMany && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <span className="text-xs font-semibold text-slate-500">Фильтры: {items.length}</span>
          <Button variant="secondary" className="h-9 px-3" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <SlidersHorizontal size={15} aria-hidden="true" />
            {expanded ? 'Скрыть' : 'Ещё фильтры'}
            <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      )}
    </section>
  );
}

export function SelectField({ label, value, onChange, options, name }) {
  const fieldName = name || String(label || 'select').toLowerCase().replace(/\s+/g, '-');

  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      <span className="truncate">{label}</span>
      <select
        name={fieldName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 transition-[border-color,box-shadow,background-color,color] duration-150 hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
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

export function ActionButton({ icon: Icon, label, title, onClick, variant = 'secondary', className = '', as: Component = 'button', to, ...props }) {
  const tone = {
    secondary: 'border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5 hover:text-brand',
    danger: 'border-red-100 bg-red-50 text-red-600 hover:border-red-200 hover:bg-red-600 hover:text-white',
    ghost: 'border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900',
    accent: 'border-accent/40 bg-accent/25 text-slate-800 hover:bg-accent/45',
  };
  const accessibilityLabel = title || label;
  const content = Icon ? <Icon size={17} strokeWidth={2.1} aria-hidden="true" /> : <span className="px-2 text-xs font-bold">{label}</span>;
  const sharedProps = {
    title: accessibilityLabel,
    'aria-label': accessibilityLabel,
    className: `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:shadow-sm active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${tone[variant] || tone.secondary} ${className}`,
    ...props,
  };

  if (Component !== 'button') {
    return <Component to={to} {...sharedProps}>{content}</Component>;
  }

  return (
    <button type="button" onClick={onClick} {...sharedProps}>
      {content}
    </button>
  );
}

export function Actions({ onEdit, onDelete, canEdit = true, canDelete = true }) {
  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex justify-end gap-2">
      {canEdit && (
        <ActionButton icon={Pencil} label="Редактировать" onClick={onEdit} />
      )}
      {canDelete && (
        <ActionButton icon={Trash2} label="Удалить" onClick={onDelete} variant="danger" />
      )}
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
            <X size={16} />
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            <Save size={16} />
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => {
          if (field.type === 'custom' && field.render) {
            return <div key={field.name} className={field.className || 'md:col-span-2'}>{field.render(form, setForm)}</div>;
          }
          if (field.type === 'client') {
            const placeholderOption = field.options?.find((option) => option.value === '');
            const clientOptions = field.options?.filter((option) => option.value !== '') || [];
            return (
              <ClientSelectWithCreate
                key={field.name}
                label={field.label}
                value={form[field.name] ?? ''}
                onChange={(value) => setForm({ ...form, [field.name]: value })}
                options={clientOptions}
                placeholder={field.placeholder || placeholderOption?.label || 'Выберите клиента'}
                required={field.required}
                disabled={field.disabled}
                error={field.error}
                onClientCreated={field.onClientCreated}
              />
            );
          }
          if (field.type === 'select') {
            return (
              <SelectField
                key={field.name}
                label={field.label}
                value={form[field.name] ?? ''}
                onChange={(value) => field.onChange ? field.onChange(value, form, setForm) : setForm({ ...form, [field.name]: value })}
                options={field.options}
              />
            );
          }
          if (field.type === 'textarea') {
            return (
              <label key={field.name} className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
                {field.label}
                <textarea
                  name={field.name}
                  autoComplete="off"
                  className="min-h-28 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition-[border-color,box-shadow,background-color,color] duration-150 hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  value={form[field.name] ?? ''}
                  onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
                />
              </label>
            );
          }
          return (
            <div key={field.name} className={field.className || ''}>
              <Input
                label={field.label}
                type={field.type || 'text'}
                name={field.name}
                value={field.type === 'datetime-local' ? formatDateTimeLocal(form[field.name]) : field.type === 'date' ? normalizeDateForInput(form[field.name]) : field.type === 'time' ? normalizeTimeForInput(form[field.name]) : form[field.name] ?? ''}
                onChange={(event) => field.onChange ? field.onChange(event.target.value, form, setForm) : setForm({ ...form, [field.name]: event.target.value })}
              />
              {field.help && <p className="mt-1 text-xs font-medium text-slate-500">{field.help}</p>}
            </div>
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
  const [editing, setEditingState] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const setEditing = (value) => {
    if (typeof value === 'function') {
      setEditingState((current) => {
        const next = value(current);
        return next && typeof next === 'object' ? normalizeItemForForm(next) : next;
      });
      return;
    }
    setEditingState(value && typeof value === 'object' ? normalizeItemForForm(value) : value);
  };

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
    try {
      const normalizedPayload = normalizePayload(payload);
      if (editing?.id) {
        await api.patch(`${endpoint}${editing.id}/`, normalizedPayload);
      } else {
        await api.post(endpoint, normalizedPayload);
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Удалить запись?')) return;
    try {
      await api.delete(`${endpoint}${id}/`);
      await load();
    } catch (error) {
      showApiError(error);
    }
  };

  return {
    items,
    setItems,
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
