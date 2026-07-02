import { Building2, CheckCircle2, Coins, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import { PageHeader } from './pageUtils.jsx';

const empty = {
  studio_name: 'EDUCRM',
  phone: '',
  email: '',
  address: '',
  currency: 'KZT',
  default_price_ab4: 0,
  default_price_ab8: 0,
  default_price_trial: 0,
  default_price_master_class: 0,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState(empty);
  const [settingsId, setSettingsId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    api.get('settings/').then(({ data }) => {
      const list = Array.isArray(data) ? data : data.results || [];
      if (list[0]) {
        setSettings({ ...empty, ...list[0] });
        setSettingsId(list[0].id);
      }
    });
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const { data } = settingsId ? await api.put(`settings/${settingsId}/`, settings) : await api.post('settings/', settings);
    setSettings({ ...empty, ...data });
    setSettingsId(data.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const set = (name, value) => setSettings({ ...settings, [name]: value });

  const importExcel = async (event) => {
    event.preventDefault();
    setImportError('');
    setImportResult(null);

    if (!importFile) {
      setImportError('Выберите файл .xlsx');
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);
    setImporting(true);

    try {
      const { data } = await api.post('/import/excel/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data);
    } catch (error) {
      setImportError(error.response?.data?.detail || 'Не удалось импортировать файл');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <PageHeader title="Настройки" />

      <form onSubmit={save} className="grid max-w-6xl gap-6 xl:grid-cols-[1fr_0.9fr]">
        <SettingsCard icon={Building2} title="Информация студии" subtitle="Контакты и базовые параметры CRM">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Название студии" value={settings.studio_name} onChange={(e) => set('studio_name', e.target.value)} />
            <Input label="Телефон" value={settings.phone || ''} onChange={(e) => set('phone', e.target.value)} />
            <Input label="Email" value={settings.email || ''} onChange={(e) => set('email', e.target.value)} />
            <Input label="Валюта" value={settings.currency || ''} onChange={(e) => set('currency', e.target.value)} />
            <Input label="Адрес" className="md:col-span-2" value={settings.address || ''} onChange={(e) => set('address', e.target.value)} />
          </div>
        </SettingsCard>

        <SettingsCard icon={Coins} title="Цены" subtitle="Значения по умолчанию для продаж">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Цена AB-4" type="number" value={settings.default_price_ab4 || 0} onChange={(e) => set('default_price_ab4', e.target.value)} />
            <Input label="Цена AB-8" type="number" value={settings.default_price_ab8 || 0} onChange={(e) => set('default_price_ab8', e.target.value)} />
            <Input label="Цена пробника" type="number" value={settings.default_price_trial || 0} onChange={(e) => set('default_price_trial', e.target.value)} />
            <Input label="Цена МК" type="number" value={settings.default_price_master_class || 0} onChange={(e) => set('default_price_master_class', e.target.value)} />
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button type="submit">Сохранить</Button>
            {saved && <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><CheckCircle2 size={16} />Сохранено</span>}
          </div>
        </SettingsCard>
      </form>

      <section className="mt-6 max-w-6xl rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
              <Upload size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Импорт Excel</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Загрузите .xlsx с листами Клиенты, Абонемент, Пробники, МК или Посещения.</p>
            </div>
          </div>
        </div>

        <form onSubmit={importExcel} className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <Input
            label="Файл .xlsx"
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              setImportFile(event.target.files?.[0] || null);
              setImportError('');
              setImportResult(null);
            }}
          />
          <Button type="submit" disabled={importing}>
            <Upload size={16} />
            {importing ? 'Импорт...' : 'Импортировать'}
          </Button>
        </form>

        {importError && <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{importError}</div>}

        {importResult && (
          <div className="mt-5 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Клиенты', importResult.created?.clients],
                ['Абонементы', importResult.created?.subscriptions],
                ['Пробники', importResult.created?.trials],
                ['МК', importResult.created?.master_classes],
                ['Посещения', importResult.created?.visits],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{value || 0}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-brand/5 px-4 py-3 text-sm font-semibold text-brand">Пропущено строк: {importResult.skipped || 0}</div>
            {importResult.warnings?.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">Warnings</p>
                <ul className="mt-2 grid max-h-64 gap-1 overflow-auto text-sm text-amber-900 scrollbar-thin">
                  {importResult.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function SettingsCard({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/45 text-slate-900">
          <Icon size={22} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
