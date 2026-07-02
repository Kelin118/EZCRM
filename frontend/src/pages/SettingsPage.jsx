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
    </>
  );
}
