import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import api from '../api/axios.js';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, setStoredUser } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('token/', form);
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
      const { data: user } = await api.get('auth/me/');
      setStoredUser(user);
      navigate('/');
    } catch {
      setError('Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-app p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand text-white">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">EZCRM</h1>
            <p className="text-sm text-slate-500">Вход в систему</p>
          </div>
        </div>
        <div className="grid gap-4">
          <Input label="Логин" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <Input
            label="Пароль"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Входим...' : 'Войти'}
          </Button>
          <Link className="text-center text-sm font-semibold text-brand hover:underline" to="/register">
            Создать первый аккаунт
          </Link>
        </div>
      </form>
    </div>
  );
}
