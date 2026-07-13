import { Database, Download } from 'lucide-react';
import { useState } from 'react';

import api from '../api/axios.js';
import { getStoredUser, isAdmin } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import { Filters, Input, PageHeader } from './pageUtils.jsx';
import { downloadBlobFile, formatExportFilename, handleExportError } from './exportUtils.jsx';
import { normalizeDateForInput } from '../utils/dateTime.js';

function isoDate(date) {
  return normalizeDateForInput(date);
}

function period(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days + 1);
  return { date_from: isoDate(from), date_to: isoDate(to) };
}

function thisMonth() {
  const now = new Date();
  return { date_from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), date_to: isoDate(now) };
}

const exportsList = [
  ['clients', 'Клиенты', 'Ученики, родители, телефоны и менеджеры', 'export/clients/'],
  ['subscriptions', 'Абонементы', 'Остатки, оплата, сроки и статусы', 'export/subscriptions/'],
  ['visits', 'Посещения', 'Отметки посещений и списания занятий', 'export/visits/'],
  ['finance', 'Финансы', 'Доходы, расходы, источники и методы оплаты', 'export/finance/'],
  ['trials', 'Пробники', 'Пробные занятия, этапы и оплаты', 'export/trials/'],
  ['master_classes', 'МК', 'Мастер-классы, участники и оплаты', 'export/master-classes/'],
  ['groups', 'Группы', 'Группы, учителя, менеджеры и ученики', 'export/groups/'],
  ['lessons', 'Уроки', 'Расписание уроков и посещаемость', 'export/lessons/'],
  ['report_summary', 'Сводный отчёт', 'Финансы, продажи, посещаемость и риски', 'export/report-summary/'],
];

export default function ExportPage() {
  const user = getStoredUser();
  const [filters, setFilters] = useState(period(30));
  const [message, setMessage] = useState('');
  const [loadingKey, setLoadingKey] = useState('');

  const downloadExport = async ([key, , , endpoint]) => {
    setLoadingKey(key);
    setMessage('');
    try {
      const { data } = await api.get(endpoint, { params: filters, responseType: 'blob' });
      downloadBlobFile(data, formatExportFilename(key));
    } catch (error) {
      setMessage(await handleExportError(error));
    } finally {
      setLoadingKey('');
    }
  };

  const createBackup = async () => {
    setLoadingKey('backup');
    setMessage('');
    try {
      const { data } = await api.post('backup/create/');
      setMessage(`Backup создан: ${data.filename}`);
    } catch (error) {
      setMessage(await handleExportError(error));
    } finally {
      setLoadingKey('');
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader title="Экспорт" />

      <Filters>
        <Input label="Дата от" type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <Input label="Дата до" type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <Button variant="secondary" onClick={() => setFilters(period(1))}>Сегодня</Button>
          <Button variant="secondary" onClick={() => setFilters(period(7))}>7 дней</Button>
          <Button variant="secondary" onClick={() => setFilters(period(30))}>30 дней</Button>
          <Button variant="secondary" onClick={() => setFilters(thisMonth())}>Этот месяц</Button>
        </div>
      </Filters>

      {message && <div className="rounded-[22px] border border-slate-100 bg-white p-4 text-sm font-semibold text-slate-700 shadow-card">{message}</div>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {exportsList.map((item) => (
          <div key={item[0]} className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
            <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-brand/10 text-brand">
              <Download size={19} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">{item[1]}</h3>
            <p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">{item[2]}</p>
            <Button className="mt-5 w-full justify-center" onClick={() => downloadExport(item)} disabled={loadingKey === item[0]}>
              <Download size={16} />
              Скачать Excel
            </Button>
          </div>
        ))}
      </section>

      {isAdmin(user) && (
        <section className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-accent/60 text-slate-900">
                <Database size={19} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Резервная копия базы</h3>
              <p className="mt-1 text-sm text-slate-500">Создаёт локальный backup в backend/backups/ на сервере.</p>
            </div>
            <Button onClick={createBackup} disabled={loadingKey === 'backup'}>
              <Database size={16} />
              Создать backup
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
