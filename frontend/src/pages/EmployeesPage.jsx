import { Edit, KeyRound, Lock, Search, UserCheck, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Table from '../components/ui/Table.jsx';
import { PageHeader, SelectField } from './pageUtils.jsx';

const roles = [
  { value: 'admin', label: 'Администратор' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'teacher', label: 'Преподаватель' },
  { value: 'accountant', label: 'Бухгалтер' },
];

const emptyEmployee = {
  username: '',
  full_name: '',
  phone: '',
  email: '',
  role: 'manager',
  is_active: true,
  password: '',
  password_confirm: '',
};

const emptyPassword = { password: '', password_confirm: '' };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [passwordForm, setPasswordForm] = useState(emptyPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredEmployees = useMemo(() => employees, [employees]);

  const load = async () => {
    const { data } = await api.get('users/employees/', { params: { search } });
    setEmployees(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    load();
  }, [search]);

  const openCreate = () => {
    setError('');
    setEditing(emptyEmployee);
    setModalOpen(true);
  };

  const openEdit = (employee) => {
    setError('');
    setEditing({
      id: employee.id,
      username: employee.username || '',
      full_name: employee.full_name || '',
      phone: employee.phone || '',
      email: employee.email || '',
      role: employee.role || 'manager',
      is_active: Boolean(employee.is_active),
    });
    setModalOpen(true);
  };

  const saveEmployee = async () => {
    setSaving(true);
    setError('');
    try {
      if (editing.id) {
        await api.patch(`users/employees/${editing.id}/`, editing);
      } else {
        await api.post('users/employees/', editing);
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (employee) => {
    if (!window.confirm(`Деактивировать пользователя ${employee.username}?`)) return;
    try {
      await api.delete(`users/employees/${employee.id}/`);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const activate = async (employee) => {
    try {
      await api.patch(`users/employees/${employee.id}/`, { is_active: true });
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const openPassword = (employee) => {
    setError('');
    setPasswordTarget(employee);
    setPasswordForm(emptyPassword);
    setPasswordModalOpen(true);
  };

  const savePassword = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`users/employees/${passwordTarget.id}/set-password/`, passwordForm);
      setPasswordModalOpen(false);
      setPasswordTarget(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const setEditingField = (name, value) => setEditing((current) => ({ ...current, [name]: value }));

  return (
    <>
      <PageHeader title="Сотрудники" actionLabel="Добавить сотрудника" onAction={openCreate} />

      <div className="mb-5 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500">
          <Search size={17} />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Поиск по имени, username, телефону"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {error && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <Table
        data={filteredEmployees}
        columns={[
          { key: 'username', header: 'Username' },
          { key: 'full_name', header: 'ФИО' },
          { key: 'phone', header: 'Телефон' },
          { key: 'email', header: 'Email' },
          { key: 'role', header: 'Роль', render: (row) => <Badge value={row.role}>{roles.find((item) => item.value === row.role)?.label || row.role}</Badge> },
          { key: 'is_active', header: 'Статус', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Активен' : 'Заблокирован'}</Badge> },
          { key: 'date_joined', header: 'Создан', render: (row) => (row.date_joined ? new Date(row.date_joined).toLocaleDateString('ru-RU') : '—') },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" onClick={() => openEdit(row)} aria-label="Редактировать">
                  <Edit size={16} />
                </Button>
                <Button variant="secondary" className="h-9 w-9 rounded-xl p-0" onClick={() => openPassword(row)} aria-label="Сменить пароль">
                  <KeyRound size={16} />
                </Button>
                {row.is_active ? (
                  <Button variant="danger" className="h-9 w-9 rounded-xl p-0" onClick={() => deactivate(row)} aria-label="Деактивировать">
                    <Lock size={16} />
                  </Button>
                ) : (
                  <Button variant="accent" className="h-9 w-9 rounded-xl p-0" onClick={() => activate(row)} aria-label="Активировать">
                    <UserCheck size={16} />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing?.id ? 'Редактировать сотрудника' : 'Добавить сотрудника'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button>
            <Button onClick={saveEmployee} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Username" value={editing.username} onChange={(event) => setEditingField('username', event.target.value)} />
            <Input label="ФИО" value={editing.full_name} onChange={(event) => setEditingField('full_name', event.target.value)} />
            <Input label="Телефон" value={editing.phone} onChange={(event) => setEditingField('phone', event.target.value)} />
            <Input label="Email" type="email" value={editing.email} onChange={(event) => setEditingField('email', event.target.value)} />
            <SelectField label="Роль" value={editing.role} onChange={(value) => setEditingField('role', value)} options={roles} />
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={editing.is_active} onChange={(event) => setEditingField('is_active', event.target.checked)} />
              Активен
            </label>
            {!editing.id && (
              <>
                <Input label="Пароль" type="password" value={editing.password} onChange={(event) => setEditingField('password', event.target.value)} />
                <Input label="Повторите пароль" type="password" value={editing.password_confirm} onChange={(event) => setEditingField('password_confirm', event.target.value)} />
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={`Сменить пароль: ${passwordTarget?.username || ''}`}
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasswordModalOpen(false)}>Отмена</Button>
            <Button onClick={savePassword} disabled={saving}>{saving ? 'Сохраняем...' : 'Сменить пароль'}</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Новый пароль" type="password" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} />
          <Input label="Повторите пароль" type="password" value={passwordForm.password_confirm} onChange={(event) => setPasswordForm({ ...passwordForm, password_confirm: event.target.value })} />
        </div>
      </Modal>
    </>
  );
}

function getErrorMessage(error) {
  const data = error.response?.data;
  if (!data) return 'Не удалось выполнить действие.';
  if (data.detail) return data.detail;
  const firstKey = Object.keys(data)[0];
  const firstValue = data[firstKey];
  return Array.isArray(firstValue) ? firstValue[0] : String(firstValue || 'Не удалось выполнить действие.');
}
