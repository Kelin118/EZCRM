import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';

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
      <form onSubmit={save} className="max-w-4xl rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название студии" value={settings.studio_name} onChange={(e) => set('studio_name', e.target.value)} />
          <Input label="Телефон" value={settings.phone || ''} onChange={(e) => set('phone', e.target.value)} />
          <Input label="Email" value={settings.email || ''} onChange={(e) => set('email', e.target.value)} />
          <Input label="Валюта" value={settings.currency || ''} onChange={(e) => set('currency', e.target.value)} />
          <Input label="Адрес" className="md:col-span-2" value={settings.address || ''} onChange={(e) => set('address', e.target.value)} />
          <Input label="Цена AB-4" type="number" value={settings.default_price_ab4 || 0} onChange={(e) => set('default_price_ab4', e.target.value)} />
          <Input label="Цена AB-8" type="number" value={settings.default_price_ab8 || 0} onChange={(e) => set('default_price_ab8', e.target.value)} />
          <Input label="Цена пробника" type="number" value={settings.default_price_trial || 0} onChange={(e) => set('default_price_trial', e.target.value)} />
          <Input label="Цена МК" type="number" value={settings.default_price_master_class || 0} onChange={(e) => set('default_price_master_class', e.target.value)} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button type="submit">Сохранить</Button>
          {saved && <span className="text-sm font-medium text-brand">Сохранено</span>}
        </div>
      </form>

      <section className="mt-6 max-w-4xl rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Импорт Excel</h3>
          <p className="mt-1 text-sm text-slate-500">Загрузите .xlsx с листами Клиенты, Абонемент, Пробники, МК или Посещения.</p>
        </div>
        <form onSubmit={importExcel} className="grid gap-4">
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
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={importing}>
              <Upload size={16} />
              {importing ? 'Импорт...' : 'Импортировать'}
            </Button>
            {importError && <span className="text-sm font-medium text-red-600">{importError}</span>}
          </div>
        </form>

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
                <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{value || 0}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-600">Пропущено строк: {importResult.skipped || 0}</p>
            {importResult.warnings?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">Warnings</p>
                <ul className="mt-2 grid max-h-64 gap-1 overflow-auto text-sm text-amber-900">
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
