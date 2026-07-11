import {
  Building2, ClipboardList, CreditCard, DoorOpen, GraduationCap, ListTodo,
  LogOut, Menu, Search, User, UserCircle, UserCog, Users, Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import api from '../../api/axios.js';
import { clearStoredAuth, getStoredUser } from '../../auth.js';
import Button from '../ui/Button.jsx';

const titles = {
  '/': 'Дашборд',
  '/clients': 'Клиенты',
  '/subscriptions': 'Абонементы',
  '/visits': 'Посещения',
  '/trials': 'Пробники',
  '/master-classes': 'Мастер-классы',
  '/tasks': 'Задачи',
  '/dictionaries': 'Справочники',
  '/export': 'Экспорт',
  '/groups': 'Группы',
  '/schedule': 'Расписание',
  '/finance': 'Финансы',
  '/reports': 'Отчёты',
  '/employees': 'Сотрудники',
  '/audit-logs': 'Журнал действий',
  '/chat': 'Чат',
  '/settings': 'Настройки',
};

const roleLabels = {
  admin: 'Администратор',
  manager: 'Менеджер',
  teacher: 'Преподаватель',
  accountant: 'Бухгалтер',
};

const resultMeta = {
  client: { label: 'Клиент', icon: User },
  subscription: { label: 'Абонемент', icon: CreditCard },
  group: { label: 'Группа', icon: Users },
  employee: { label: 'Сотрудник', icon: UserCog },
  trial: { label: 'Пробник', icon: ClipboardList },
  task: { label: 'Задача', icon: ListTodo },
  master_class: { label: 'Мастер-класс', icon: GraduationCap },
  finance: { label: 'Финансы', icon: Wallet },
  branch: { label: 'Филиал', icon: Building2 },
  room: { label: 'Кабинет', icon: DoorOpen },
};

export default function Topbar({ onMenuClick }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const searchRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setResults([]);
      setSearchState('idle');
      setActiveIndex(-1);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchState('loading');
      setSearchOpen(true);
      try {
        const { data } = await api.get('search/', { params: { q: query }, signal: controller.signal });
        setResults(data.results || []);
        setSearchState('success');
        setActiveIndex(-1);
      } catch (error) {
        if (error.code !== 'ERR_CANCELED') setSearchState('error');
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, []);

  const openResult = (result) => {
    if (!result) return;
    setSearchOpen(false);
    setSearchQuery('');
    navigate(result.url);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setSearchOpen(false);
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchOpen(true);
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openResult(results[activeIndex >= 0 ? activeIndex : 0]);
    }
  };

  const logout = () => {
    clearStoredAuth();
    navigate('/login');
  };

  const title = location.pathname.startsWith('/clients/')
    ? 'Карточка клиента'
    : location.pathname.startsWith('/lessons/')
      ? 'Отметка посещений'
      : titles[location.pathname] || 'EZCRM';

  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-app/90 px-3 py-3 backdrop-blur sm:px-4 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] items-center gap-3">
        <Button variant="secondary" className="h-10 w-10 shrink-0 p-0 lg:hidden" onClick={onMenuClick} aria-label="Открыть меню">
          <Menu size={19} />
        </Button>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
          <p className="hidden text-sm font-medium text-slate-500 sm:block">CRM для учебного центра</p>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2 lg:flex-1 lg:justify-end">
          <div ref={searchRef} className="relative hidden min-w-0 flex-1 md:block lg:max-w-md">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/10">
              <Search size={17} />
              <input
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
                onFocus={() => { if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
                onKeyDown={handleSearchKeyDown}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                placeholder="Поиск по CRM"
                aria-label="Поиск по CRM"
                role="combobox"
                aria-expanded={searchOpen}
                aria-controls="global-search-results"
              />
            </label>
            {searchOpen && searchQuery.trim().length >= 2 && (
              <div id="global-search-results" className="absolute right-0 top-full z-50 mt-2 max-h-[min(70vh,34rem)] w-full min-w-[22rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                {searchState === 'loading' && <p className="px-3 py-5 text-center text-sm text-slate-500">Поиск…</p>}
                {searchState === 'error' && <p className="px-3 py-5 text-center text-sm text-red-600">Не удалось выполнить поиск</p>}
                {searchState === 'success' && results.length === 0 && <p className="px-3 py-5 text-center text-sm text-slate-500">Ничего не найдено</p>}
                {searchState === 'success' && results.map((result, index) => {
                  const meta = resultMeta[result.type] || resultMeta.client;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => openResult(result)}
                      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${activeIndex === index ? 'bg-brand/10' : 'hover:bg-slate-50'}`}
                    >
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-brand"><Icon size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">{result.title}</span>
                        {result.subtitle && <span className="block truncate text-xs text-slate-500">{result.subtitle}</span>}
                        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">{meta.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm sm:flex">
            <UserCircle size={22} className="text-brand" />
            <div className="min-w-0 leading-tight">
              <p className="max-w-44 truncate text-sm font-semibold text-slate-800">{user?.full_name || user?.username || 'Пользователь'}</p>
              <p className="text-xs text-slate-500">{roleLabels[user?.role] || user?.role || 'онлайн'}</p>
            </div>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={logout}>
            <LogOut size={17} />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
