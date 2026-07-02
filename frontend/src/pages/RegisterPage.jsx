import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

const initialForm = {
  username: '',
  full_name: '',
  phone: '',
  email: '',
  password: '',
  password_confirm: '',
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await api.post('auth/register/', form);
      setSuccess('Аккаунт администратора создан. Сейчас откроется вход.');
      window.setTimeout(() => navigate('/login'), 1200);
    } catch (requestError) {
      const data = requestError.response?.data;
      setError(data?.detail || data?.password_confirm?.[0] || data?.password?.[0] || 'Не удалось создать аккаунт.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-app p-4">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-2xl border border-slate-100 bg-white p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand text-white">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">EZCRM</h1>
            <p className="text-sm text-slate-500">Создание первого аккаунта администратора</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Логин" value={form.username} onChange={(event) => set('username', event.target.value)} />
          <Input label="ФИО" value={form.full_name} onChange={(event) => set('full_name', event.target.value)} />
          <Input label="Телефон" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
          <Input label="Email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
          <Input label="Пароль" type="password" value={form.password} onChange={(event) => set('password', event.target.value)} />
          <Input label="Повторите пароль" type="password" value={form.password_confirm} onChange={(event) => set('password_confirm', event.target.value)} />
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {success && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</p>}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link className="text-sm font-semibold text-brand hover:underline" to="/login">
            Уже есть аккаунт
          </Link>
          <Button type="submit" disabled={loading}>
            {loading ? 'Создаём...' : 'Создать администратора'}
          </Button>
        </div>
      </form>
    </div>
  );
}
