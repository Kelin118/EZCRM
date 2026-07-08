import { useMemo, useState } from 'react';

import api from '../../api/axios.js';
import { getStoredUser } from '../../auth.js';
import { useEmployeeOptions } from '../../pages/lookupUtils.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';

const emptyForm = {
  first_name: '',
  last_name: '',
  parent_name: '',
  phone: '',
  email: '',
  birth_date: '',
  notes: '',
  manager: '',
};

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function formFullName(form) {
  return normalizeText(`${form.first_name || ''} ${form.last_name || ''}`);
}

function clientFullName(client) {
  return normalizeText(client.full_name || `${client.first_name || ''} ${client.last_name || ''}`);
}

function isSameClientName(client, form) {
  return clientFullName(client) === formFullName(form);
}

function clientName(client) {
  return client.display_name || client.full_name || `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.phone || `Клиент #${client.id}`;
}

function clientParent(client) {
  return client.parent_name || 'Родитель не указан';
}

function dispatchToast(message) {
  window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
}

function getApiErrorMessage(error) {
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

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
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

export default function QuickClientCreateModal({ open, onClose, onCreated }) {
  const user = getStoredUser();
  const { employeeOptions } = useEmployeeOptions(['admin', 'manager']);
  const [form, setForm] = useState(() => ({ ...emptyForm, manager: user?.id ? String(user.id) : '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingClients, setExistingClients] = useState([]);

  const managerOptions = useMemo(() => [{ value: '', label: 'Не выбран' }, ...employeeOptions], [employeeOptions]);

  const close = (force = false) => {
    if (saving && !force) return;
    setError('');
    setExistingClients([]);
    setForm({ ...emptyForm, manager: user?.id ? String(user.id) : '' });
    onClose();
  };

  const update = (patch) => {
    setError('');
    setExistingClients([]);
    setForm((current) => ({ ...current, ...patch }));
  };

  const findExistingByPhone = async () => {
    const phone = form.phone.trim();
    if (!phone) return [];

    const { data } = await api.get('clients/', { params: { search: phone } });
    const items = Array.isArray(data) ? data : data.results || [];
    const normalizedPhone = normalizePhone(phone);
    return items.filter((client) => normalizePhone(client.phone) === normalizedPhone);
  };

  const chooseExisting = (client) => {
    if (!client) return;
    onCreated(client);
    dispatchToast('Клиент выбран');
    close();
  };

  const createClient = async () => {
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      parent_name: form.parent_name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      birth_date: form.birth_date || null,
      notes: form.notes.trim(),
      manager: form.manager || null,
      is_active: true,
    };
    const { data } = await api.post('clients/', payload);
    onCreated(data);
    dispatchToast('Клиент добавлен');
    close(true);
  };

  const submit = async (forceCreate = false) => {
    if (!form.first_name.trim()) {
      setError('Укажите имя клиента.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (!forceCreate) {
        const found = await findExistingByPhone();
        if (found.length) {
          setExistingClients(found);
          setError('С этим номером уже есть клиенты. Если это брат или сестра, можно создать нового клиента с этим же номером.');
          return;
        }
      }

      await createClient();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError) || 'Не удалось создать клиента');
    } finally {
      setSaving(false);
    }
  };

  const sameNameExists = existingClients.some((client) => isSameClientName(client, form));

  return (
    <Modal
      title="Новый клиент"
      open={open}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>Отмена</Button>
          {existingClients.length > 0 ? (
            <Button onClick={() => submit(true)} disabled={saving}>
              {saving ? 'Создаем...' : sameNameExists ? 'Всё равно создать нового' : 'Создать как нового ребёнка'}
            </Button>
          ) : (
            <Button onClick={() => submit()} disabled={saving}>{saving ? 'Создаем...' : 'Создать клиента'}</Button>
          )}
        </>
      }
    >
      {error && (
        <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
          existingClients.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-100 bg-red-50 text-red-700'
        }`}>
          {error}
          {existingClients.length > 0 && (
            <div className="mt-3 grid gap-2">
              <div className="text-sm font-bold text-slate-800">С таким номером уже есть клиенты</div>
              {existingClients.map((client) => (
                <div key={client.id} className="grid gap-2 rounded-xl bg-white/85 p-3 text-slate-700 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="grid gap-1">
                    <span className="font-semibold text-slate-900">{clientName(client)}</span>
                    <span className="text-xs text-slate-500">{clientParent(client)} · {client.phone || 'Телефон не указан'}</span>
                  </div>
                  {isSameClientName(client, form) && (
                    <Button variant="secondary" className="min-h-9 px-3 py-1.5" onClick={() => chooseExisting(client)}>
                      Выбрать существующего
                    </Button>
                  )}
                </div>
              ))}
              {!sameNameExists && (
                <Button className="mt-1 justify-self-start" onClick={() => submit(true)} disabled={saving}>
                  Создать как нового ребёнка
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Имя клиента" value={form.first_name} onChange={(event) => update({ first_name: event.target.value })} required />
        <Input label="Фамилия" value={form.last_name} onChange={(event) => update({ last_name: event.target.value })} />
        <Input label="Телефон" value={form.phone} onChange={(event) => update({ phone: event.target.value })} />
        <Input label="Родитель" value={form.parent_name} onChange={(event) => update({ parent_name: event.target.value })} />
        <Input label="WhatsApp / email" type="email" value={form.email} onChange={(event) => update({ email: event.target.value })} />
        <Input label="Дата рождения" type="date" value={form.birth_date} onChange={(event) => update({ birth_date: event.target.value })} />
        <SelectField label="Менеджер" value={form.manager} onChange={(value) => update({ manager: value })} options={managerOptions} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">
          Комментарий
          <textarea
            className="min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={form.notes}
            onChange={(event) => update({ notes: event.target.value })}
          />
        </label>
      </div>
    </Modal>
  );
}
