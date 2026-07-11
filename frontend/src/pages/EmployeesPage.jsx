import { KeyRound, Lock, Pencil, Search, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Table from '../components/ui/Table.jsx';
import { ActionButton, PageHeader } from './pageUtils.jsx';
import { SelectField } from './pageUtils.jsx';
import useBranches from '../hooks/useBranches.js';

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
  roles: ['manager'],
  is_active: true,
  password: '',
  branch: '',
};

const emptyPassword = { password: '', password_confirm: '' };

const roleLabel = (value) => roles.find((item) => item.value === value)?.label || value;
const getEmployeeRoles = (employee) => (Array.isArray(employee.roles) && employee.roles.length ? employee.roles : [employee.role].filter(Boolean));

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [passwordForm, setPasswordForm] = useState(emptyPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { branchOptions, branchFilterOptions } = useBranches();

  const filteredEmployees = useMemo(() => employees, [employees]);

  const load = async () => {
    const { data } = await api.get('users/employees/', { params: { search, branch: branchFilter } });
    setEmployees(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    load();
  }, [search, branchFilter]);

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
      roles: getEmployeeRoles(employee),
      is_active: Boolean(employee.is_active),
      password: '',
      branch: employee.branch ? String(employee.branch) : '',
    });
    setModalOpen(true);
  };

  const saveEmployee = async () => {
    setSaving(true);
    setError('');
    try {
      const selectedRoles = getEmployeeRoles(editing);
      if (!selectedRoles.length) {
        setError('Выберите хотя бы одну роль.');
        return;
      }
      const payload = { ...editing, roles: selectedRoles, role: selectedRoles[0] };
      if (!payload.username?.trim()) {
        setError('Введите логин');
        return;
      }
      if (!editing.id && !payload.password) {
        setError('Введите пароль');
        return;
      }
      if (payload.password && payload.password.length < 4) {
        setError('Пароль слишком короткий');
        return;
      }
      if (editing.id && !payload.password) {
        delete payload.password;
      }
      if (editing.id) {
        await api.patch(`users/employees/${editing.id}/`, payload);
      } else {
        await api.post('users/employees/', payload);
      }
      const message = editing.id ? 'Сотрудник сохранен' : 'Сотрудник создан';
      setModalOpen(false);
      setEditing(null);
      await load();
      window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
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
      await api.patch(`users/employees/${employee.id}/`, { is_active: true, roles: getEmployeeRoles(employee) });
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

  const toggleRole = (roleValue) => {
    setEditing((current) => {
      const currentRoles = getEmployeeRoles(current);
      const nextRoles = currentRoles.includes(roleValue)
        ? currentRoles.filter((item) => item !== roleValue)
        : [...currentRoles, roleValue];
      return { ...current, roles: nextRoles };
    });
  };

  return (
    <>
      <PageHeader title="Сотрудники" actionLabel="Добавить сотрудника" onAction={openCreate} />

      <div className="mb-5 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500">
          <Search size={17} />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            placeholder="Поиск по имени, username, телефону"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <SelectField label="Филиал" value={branchFilter} onChange={setBranchFilter} options={branchFilterOptions} />
        </div>
      </div>

      {error && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <Table
        data={filteredEmployees}
        columns={[
          { key: 'full_name', header: 'ФИО' },
          { key: 'username', header: 'Username' },
          { key: 'branch_name', header: 'Филиал', render: (row) => row.branch_name || 'Не распределено' },
          {
            key: 'roles',
            header: 'Роли',
            render: (row) => (
              <div className="flex flex-wrap gap-1.5">
                {getEmployeeRoles(row).map((roleValue) => <Badge key={roleValue} value={roleValue}>{roleLabel(roleValue)}</Badge>)}
              </div>
            ),
          },
          { key: 'is_active', header: 'Активен', render: (row) => <Badge value={row.is_active ? 'active' : 'cancelled'}>{row.is_active ? 'Да' : 'Нет'}</Badge> },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <ActionButton icon={Pencil} label="Редактировать" onClick={() => openEdit(row)} />
                <ActionButton icon={KeyRound} label="Сменить пароль" onClick={() => openPassword(row)} />
                {row.is_active ? (
                  <ActionButton icon={Lock} label="Деактивировать" onClick={() => deactivate(row)} variant="danger" />
                ) : (
                  <ActionButton icon={UserCheck} label="Активировать" onClick={() => activate(row)} variant="accent" />
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing?.id ? 'Редактировать сотрудника' : 'Новый сотрудник'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Отмена</Button>
            <Button onClick={saveEmployee} disabled={saving}>{saving ? 'Сохраняем...' : (editing?.id ? 'Сохранить' : 'Создать')}</Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="ФИО" value={editing.full_name} onChange={(event) => setEditingField('full_name', event.target.value)} />
            <Input label="Логин" value={editing.username} onChange={(event) => setEditingField('username', event.target.value)} />
            <SelectField label="Филиал" value={editing.branch || ''} onChange={(value) => setEditingField('branch', value)} options={[{ value: '', label: 'Не распределено' }, ...branchOptions]} />
            <Input
              label={editing.id ? 'Новый пароль' : 'Пароль'}
              type="password"
              value={editing.password || ''}
              onChange={(event) => setEditingField('password', event.target.value)}
            />
            <div className="grid gap-2 md:col-span-2">
              <p className="text-sm font-semibold text-slate-700">Роли</p>
              <div className="grid gap-2 md:grid-cols-2">
                {roles.map((roleItem) => (
                  <label key={roleItem.value} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={getEmployeeRoles(editing).includes(roleItem.value)} onChange={() => toggleRole(roleItem.value)} />
                    {roleItem.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={editing.is_active} onChange={(event) => setEditingField('is_active', event.target.checked)} />
              Активен
            </label>
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
