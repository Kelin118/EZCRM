import { BadgePercent, Ban, Building2, CheckCircle2, CreditCard, Edit, Package, Plus, RotateCcw, ToggleLeft, Upload, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import { canEditStudioSettings, canImportExcel, getStoredUser, isAdmin } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import { PageHeader } from './pageUtils.jsx';
import { formatScheduleDays, weekdayOptions } from '../utils/subscriptionDates.js';
import usePaymentMethods from '../hooks/usePaymentMethods.js';

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

const emptyCatalogForm = {
  name: '',
  price: '',
  lessons_count: '',
  validity_days: '',
  schedule_days: [],
  is_active: true,
  sort_order: 0,
};
const emptyBranchForm = { name: '', address: '', phone: '', description: '', is_active: true };
const emptyPaymentMethodForm = { name: '', code: '', description: '', is_active: true, sort_order: 0 };
const emptyDiscountForm = { name: '', discount_type: 'percentage', value: '', branch: '', valid_from: '', valid_until: '', description: '', is_active: true };

const catalogSections = [
  { category: 'service', title: 'Услуги', addLabel: 'Добавить услугу', modalCreate: 'Новая услуга', icon: Wrench },
  { category: 'product', title: 'Товары', addLabel: 'Добавить товар', modalCreate: 'Новый товар', icon: Package },
  { category: 'addon', title: 'Доп. услуги', addLabel: 'Добавить доп. услугу', modalCreate: 'Новая доп. услуга', icon: Plus },
];

function money(value) {
  return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
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

export default function SettingsPage() {
  const user = getStoredUser();
  const canEditStudio = canEditStudioSettings(user);
  const canEditCatalog = isAdmin(user);
  const canImport = canImportExcel(user);
  const [settings, setSettings] = useState(empty);
  const [settingsId, setSettingsId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogModal, setCatalogModal] = useState({ open: false, category: 'service', item: null });
  const [catalogForm, setCatalogForm] = useState(emptyCatalogForm);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchModal, setBranchModal] = useState({ open: false, item: null });
  const [branchForm, setBranchForm] = useState(emptyBranchForm);
  const { paymentMethods, refreshPaymentMethods } = usePaymentMethods({ activeOnly: false });
  const [paymentMethodModal, setPaymentMethodModal] = useState({ open: false, item: null });
  const [paymentMethodForm, setPaymentMethodForm] = useState(emptyPaymentMethodForm);
  const [discounts, setDiscounts] = useState([]);
  const [discountModal, setDiscountModal] = useState({ open: false, item: null });
  const [discountForm, setDiscountForm] = useState(emptyDiscountForm);

  const activeSection = useMemo(
    () => catalogSections.find((section) => section.category === catalogModal.category) || catalogSections[0],
    [catalogModal.category],
  );

  useEffect(() => {
    api.get('settings/').then(({ data }) => {
      const list = Array.isArray(data) ? data : data.results || [];
      if (list[0]) {
        setSettings({ ...empty, ...list[0] });
        setSettingsId(list[0].id);
      }
    });
    loadCatalogItems();
    loadBranches();
    loadDiscounts();
  }, []);

  const loadDiscounts = async () => {
    const { data } = await api.get('discounts/');
    setDiscounts(Array.isArray(data) ? data : data.results || []);
  };

  const saveDiscount = async () => {
    const payload = {
      ...discountForm,
      value: Number(discountForm.value),
      branch: discountForm.branch || null,
      valid_from: discountForm.valid_from || null,
      valid_until: discountForm.valid_until || null,
    };
    if (discountModal.item) await api.patch(`discounts/${discountModal.item.id}/`, payload);
    else await api.post('discounts/', payload);
    setDiscountModal({ open: false, item: null });
    setDiscountForm(emptyDiscountForm);
    await loadDiscounts();
  };

  const toggleDiscount = async (discount) => {
    await api.patch(`discounts/${discount.id}/`, { is_active: !discount.is_active });
    await loadDiscounts();
  };

  const loadBranches = async () => {
    const { data } = await api.get('branches/');
    setBranches(Array.isArray(data) ? data : data.results || []);
  };

  const saveBranch = async () => {
    if (!branchForm.name.trim()) return;
    if (branchModal.item) await api.patch(`branches/${branchModal.item.id}/`, branchForm);
    else await api.post('branches/', branchForm);
    setBranchModal({ open: false, item: null });
    setBranchForm(emptyBranchForm);
    await loadBranches();
  };

  const disableBranch = async (branch) => {
    await api.delete(`branches/${branch.id}/`);
    await loadBranches();
  };

  const savePaymentMethod = async () => {
    if (!paymentMethodForm.name.trim()) return;
    if (paymentMethodModal.item) await api.patch(`payment-methods/${paymentMethodModal.item.id}/`, paymentMethodForm);
    else await api.post('payment-methods/', paymentMethodForm);
    setPaymentMethodModal({ open: false, item: null });
    setPaymentMethodForm(emptyPaymentMethodForm);
    await refreshPaymentMethods();
  };

  const togglePaymentMethod = async (item) => {
    await api.patch(`payment-methods/${item.id}/`, { is_active: !item.is_active });
    await refreshPaymentMethods();
  };

  const loadCatalogItems = async () => {
    setCatalogLoading(true);
    try {
      const { data } = await api.get('catalog-items/');
      setCatalogItems(Array.isArray(data) ? data : data.results || []);
    } finally {
      setCatalogLoading(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canEditStudio) return;
    const { data } = settingsId ? await api.put(`settings/${settingsId}/`, settings) : await api.post('settings/', settings);
    setSettings({ ...empty, ...data });
    setSettingsId(data.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const set = (name, value) => setSettings({ ...settings, [name]: value });

  const openCatalogModal = (category, item = null) => {
    setCatalogError('');
    setCatalogModal({ open: true, category, item });
    setCatalogForm(
      item
        ? { name: item.name ?? '', price: item.price ?? '', lessons_count: item.lessons_count ?? '', validity_days: item.validity_days ?? '', schedule_days: Array.isArray(item.schedule_days) ? [...item.schedule_days] : [], is_active: item.is_active ?? true, sort_order: item.sort_order ?? 0 }
        : { ...emptyCatalogForm },
    );
  };

  const closeCatalogModal = (force = false) => {
    if (catalogSaving && !force) return;
    setCatalogModal({ open: false, category: 'service', item: null });
    setCatalogForm(emptyCatalogForm);
    setCatalogError('');
  };

  const toggleCatalogScheduleDay = (day) => {
    const current = Array.isArray(catalogForm.schedule_days) ? catalogForm.schedule_days : [];
    setCatalogForm({
      ...catalogForm,
      schedule_days: current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    });
  };

  const saveCatalogItem = async () => {
    const name = catalogForm.name.trim();
    const price = Number(catalogForm.price);

    if (!name) {
      setCatalogError('Укажите наименование.');
      return;
    }
    if (catalogForm.price === '' || Number.isNaN(price)) {
      setCatalogError('Укажите цену.');
      return;
    }
    if (price < 0) {
      setCatalogError('Цена не может быть меньше 0.');
      return;
    }

    setCatalogSaving(true);
    setCatalogError('');
    const payload = {
      name,
      price,
      category: catalogModal.category,
      is_active: catalogForm.is_active,
      sort_order: catalogForm.sort_order !== '' ? Number(catalogForm.sort_order) : 0,
      lessons_count: catalogModal.category === 'service' && catalogForm.lessons_count !== '' ? Number(catalogForm.lessons_count) : null,
      validity_days: catalogModal.category === 'service' && catalogForm.validity_days !== '' ? Number(catalogForm.validity_days) : null,
      schedule_days: catalogModal.category === 'service' ? catalogForm.schedule_days : [],
    };

    try {
      if (catalogModal.item?.id) {
        await api.patch(`catalog-items/${catalogModal.item.id}/`, payload);
      } else {
        await api.post('catalog-items/', payload);
      }
      closeCatalogModal(true);
      await loadCatalogItems();
    } catch (error) {
      setCatalogError(getApiErrorMessage(error));
    } finally {
      setCatalogSaving(false);
    }
  };

  const disableCatalogItem = async (item) => {
    if (!window.confirm(`Отключить позицию "${item.name}"?`)) return;
    await api.delete(`catalog-items/${item.id}/`);
    await loadCatalogItems();
  };

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

      <form onSubmit={save} className="max-w-6xl">
        <SettingsCard icon={Building2} title="Информация студии" subtitle="Контакты и базовые параметры CRM">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Название студии" value={settings.studio_name} disabled={!canEditStudio} onChange={(e) => set('studio_name', e.target.value)} />
            <Input label="Телефон" value={settings.phone || ''} disabled={!canEditStudio} onChange={(e) => set('phone', e.target.value)} />
            <Input label="Email" value={settings.email || ''} disabled={!canEditStudio} onChange={(e) => set('email', e.target.value)} />
            <Input label="Валюта" value={settings.currency || ''} disabled={!canEditStudio} onChange={(e) => set('currency', e.target.value)} />
            <Input label="Адрес" className="md:col-span-2" value={settings.address || ''} disabled={!canEditStudio} onChange={(e) => set('address', e.target.value)} />
          </div>
          {canEditStudio && (
            <div className="mt-5 flex items-center gap-3">
              <Button type="submit">Сохранить</Button>
              {saved && <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><CheckCircle2 size={16} />Сохранено</span>}
            </div>
          )}
        </SettingsCard>
      </form>

      <div className="mt-6 grid max-w-6xl gap-6">
        <SettingsCard icon={Building2} title="Филиалы" subtitle="Подразделения учебного центра">
          {canEditStudio && (
            <Button className="mb-4" onClick={() => { setBranchForm(emptyBranchForm); setBranchModal({ open: true, item: null }); }}>
              <Plus size={16} />Добавить филиал
            </Button>
          )}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                <th className="px-4 py-3">Название</th><th className="px-4 py-3">Адрес</th><th className="px-4 py-3">Телефон</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3" />
              </tr></thead>
              <tbody>{branches.map((branch) => <tr key={branch.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{branch.name}</td><td className="px-4 py-3">{branch.address || '—'}</td><td className="px-4 py-3">{branch.phone || '—'}</td>
                <td className="px-4 py-3">{branch.is_active ? 'Активен' : 'Отключён'}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2">
                  {canEditStudio && <Button variant="secondary" onClick={() => { setBranchForm({ ...emptyBranchForm, ...branch, is_active: branch.is_active ?? true }); setBranchModal({ open: true, item: branch }); }}>Изменить</Button>}
                  {canEditStudio && branch.is_active && <Button variant="secondary" onClick={() => disableBranch(branch)}>Отключить</Button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </SettingsCard>
        <SettingsCard icon={CreditCard} title="Способы оплаты" subtitle="Доступные способы при оформлении оплат">
          {canEditCatalog && <Button className="mb-4" onClick={() => { setPaymentMethodForm(emptyPaymentMethodForm); setPaymentMethodModal({ open: true, item: null }); }}><Plus size={16} />Добавить способ оплаты</Button>}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Название</th><th className="px-4 py-3">Описание</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3" /></tr></thead>
              <tbody>{paymentMethods.map((item) => <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{item.name}</td><td className="px-4 py-3">{item.description || '—'}</td><td className="px-4 py-3">{item.is_active ? 'Активен' : 'Отключён'}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2">
                  {canEditCatalog && <Button variant="secondary" onClick={() => { setPaymentMethodForm({ ...emptyPaymentMethodForm, ...item, is_active: item.is_active ?? true, sort_order: item.sort_order ?? 0 }); setPaymentMethodModal({ open: true, item }); }}><Edit size={15} />Изменить</Button>}
                  {canEditCatalog && <Button variant="secondary" onClick={() => togglePaymentMethod(item)}>{item.is_active ? <Ban size={15} /> : <RotateCcw size={15} />}{item.is_active ? 'Отключить' : 'Включить'}</Button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </SettingsCard>
        <SettingsCard icon={BadgePercent} title="Скидки" subtitle="Процентные и фиксированные скидки для продаж">
          {canEditCatalog && <Button className="mb-4" onClick={() => { setDiscountForm(emptyDiscountForm); setDiscountModal({ open: true, item: null }); }}><Plus size={16} />Добавить скидку</Button>}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                <th className="px-4 py-3">Название</th><th className="px-4 py-3">Тип</th><th className="px-4 py-3">Значение</th><th className="px-4 py-3">Филиал</th><th className="px-4 py-3">Действует</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3" />
              </tr></thead>
              <tbody>{discounts.map((item) => <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{item.name}</td>
                <td className="px-4 py-3">{item.discount_type === 'percentage' ? 'Процент' : 'Фикс.'}</td>
                <td className="px-4 py-3">{item.discount_type === 'percentage' ? `${Number(item.value)}%` : `${money(item.value)} ₸`}</td>
                <td className="px-4 py-3">{item.branch_name || 'Все филиалы'}</td>
                <td className="px-4 py-3">{[item.valid_from || '—', item.valid_until || '—'].join(' — ')}</td>
                <td className="px-4 py-3">{item.is_active ? 'Активна' : 'Отключена'}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2">
                  {canEditCatalog && <Button variant="secondary" onClick={() => { setDiscountForm({ ...emptyDiscountForm, ...item, branch: item.branch ? String(item.branch) : '', value: item.value ?? '' }); setDiscountModal({ open: true, item }); }}><Edit size={15} />Изменить</Button>}
                  {canEditCatalog && <Button variant="secondary" onClick={() => toggleDiscount(item)}>{item.is_active ? <Ban size={15} /> : <RotateCcw size={15} />}{item.is_active ? 'Отключить' : 'Включить'}</Button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </SettingsCard>
        {catalogSections.map((section) => (
          <CatalogSection
            key={section.category}
            section={section}
            items={catalogItems.filter((item) => item.category === section.category)}
            loading={catalogLoading}
            canEdit={canEditCatalog}
            onAdd={() => openCatalogModal(section.category)}
            onEdit={(item) => openCatalogModal(section.category, item)}
            onDisable={disableCatalogItem}
          />
        ))}
      </div>

      {canImport && <section className="mt-6 max-w-6xl rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
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
      </section>}

      <Modal
        title={branchModal.item ? 'Редактировать филиал' : 'Новый филиал'}
        open={branchModal.open}
        onClose={() => setBranchModal({ open: false, item: null })}
        footer={<><Button variant="secondary" onClick={() => setBranchModal({ open: false, item: null })}>Отмена</Button><Button onClick={saveBranch}>Сохранить</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
          <Input label="Телефон" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} />
          <Input label="Адрес" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} />
          <Input label="Комментарий" value={branchForm.description} onChange={(e) => setBranchForm({ ...branchForm, description: e.target.value })} />
        </div>
      </Modal>

      <Modal
        title={paymentMethodModal.item ? 'Редактировать способ оплаты' : 'Новый способ оплаты'}
        open={paymentMethodModal.open}
        onClose={() => setPaymentMethodModal({ open: false, item: null })}
        footer={<><Button variant="secondary" onClick={() => setPaymentMethodModal({ open: false, item: null })}>Отмена</Button><Button onClick={savePaymentMethod}>Сохранить</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название" value={paymentMethodForm.name} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, name: event.target.value })} />
          <Input label="Код" value={paymentMethodForm.code || ''} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, code: event.target.value })} />
          <Input label="Порядок" type="number" value={paymentMethodForm.sort_order ?? 0} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, sort_order: event.target.value })} />
          <Input label="Описание" className="md:col-span-2" value={paymentMethodForm.description || ''} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, description: event.target.value })} />
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={paymentMethodForm.is_active} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, is_active: event.target.checked })} />Активен</label>
        </div>
      </Modal>

      <Modal
        title={discountModal.item ? 'Редактировать скидку' : 'Новая скидка'}
        open={discountModal.open}
        onClose={() => setDiscountModal({ open: false, item: null })}
        footer={<><Button variant="secondary" onClick={() => setDiscountModal({ open: false, item: null })}>Отмена</Button><Button onClick={saveDiscount}>Сохранить</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название" value={discountForm.name} onChange={(event) => setDiscountForm({ ...discountForm, name: event.target.value })} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Тип скидки
            <select value={discountForm.discount_type} onChange={(event) => setDiscountForm({ ...discountForm, discount_type: event.target.value })} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none">
              <option value="percentage">Процентная</option>
              <option value="fixed">Фиксированная</option>
            </select>
          </label>
          <Input label={discountForm.discount_type === 'percentage' ? 'Значение, %' : 'Значение, ₸'} type="number" min="0" value={discountForm.value} onChange={(event) => setDiscountForm({ ...discountForm, value: event.target.value })} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Филиал
            <select value={discountForm.branch || ''} onChange={(event) => setDiscountForm({ ...discountForm, branch: event.target.value })} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none">
              <option value="">Все филиалы</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <Input label="Действует с" type="date" value={discountForm.valid_from || ''} onChange={(event) => setDiscountForm({ ...discountForm, valid_from: event.target.value })} />
          <Input label="Действует до" type="date" value={discountForm.valid_until || ''} onChange={(event) => setDiscountForm({ ...discountForm, valid_until: event.target.value })} />
          <Input label="Описание" className="md:col-span-2" value={discountForm.description || ''} onChange={(event) => setDiscountForm({ ...discountForm, description: event.target.value })} />
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={discountForm.is_active} onChange={(event) => setDiscountForm({ ...discountForm, is_active: event.target.checked })} />Активна</label>
        </div>
      </Modal>

      <Modal
        title={catalogModal.item ? `Изменить: ${catalogModal.item.name}` : activeSection.modalCreate}
        open={catalogModal.open}
        onClose={closeCatalogModal}
        footer={
          <>
            <Button variant="secondary" onClick={() => closeCatalogModal()} disabled={catalogSaving}>Отмена</Button>
            <Button onClick={saveCatalogItem} disabled={catalogSaving}>{catalogSaving ? 'Сохранение...' : 'Сохранить'}</Button>
          </>
        }
      >
        {catalogError && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{catalogError}</div>}
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Наименование" value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} />
          <Input label="Цена" type="number" min="0" value={catalogForm.price} onChange={(event) => setCatalogForm({ ...catalogForm, price: event.target.value })} />
          <Input label="Порядок" type="number" min="0" value={catalogForm.sort_order ?? 0} onChange={(event) => setCatalogForm({ ...catalogForm, sort_order: event.target.value })} />
          {catalogModal.category === 'service' && (
            <>
              <Input label="Количество занятий" type="number" min="1" value={catalogForm.lessons_count} onChange={(event) => setCatalogForm({ ...catalogForm, lessons_count: event.target.value })} />
              <Input label="Срок действия, дней" type="number" min="1" value={catalogForm.validity_days} onChange={(event) => setCatalogForm({ ...catalogForm, validity_days: event.target.value })} />
              <div className="grid gap-2 md:col-span-2">
                <p className="text-sm font-semibold text-slate-700">Дни недели</p>
                <div className="flex flex-wrap gap-2">
                  {weekdayOptions.map((day) => (
                    <label key={day.value} className={`flex min-h-10 items-center rounded-2xl border px-4 py-2 text-sm font-bold ${catalogForm.schedule_days?.includes(day.value) ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                      <input className="sr-only" type="checkbox" checked={catalogForm.schedule_days?.includes(day.value) || false} onChange={() => toggleCatalogScheduleDay(day.value)} />
                      {day.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          {catalogModal.item && (
            <label className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={catalogForm.is_active}
                onChange={(event) => setCatalogForm({ ...catalogForm, is_active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
              />
              Активен
            </label>
          )}
        </div>
      </Modal>
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

function CatalogSection({ section, items, loading, canEdit, onAdd, onEdit, onDisable }) {
  const Icon = section.icon;

  return (
    <section className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
            <Icon size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{section.title}</h3>
            <p className="text-sm text-slate-500">Позиции справочника цен для продаж и оплат</p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={onAdd}>
            <Plus size={16} />
            {section.addLabel}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="min-w-[720px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="border-b border-slate-100 px-4 py-3 font-bold">Наименование</th>
              <th className="border-b border-slate-100 px-4 py-3 font-bold">Цена</th>
              {section.category === 'service' && (
                <>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">Занятий</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">Срок действия</th>
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">Дни недели</th>
                </>
              )}
              <th className="border-b border-slate-100 px-4 py-3 font-bold">Статус</th>
              <th className="border-b border-slate-100 px-4 py-3 text-right font-bold">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={section.category === 'service' ? 7 : 4} className="px-4 py-8 text-center font-semibold text-slate-500">Загрузка...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={section.category === 'service' ? 7 : 4} className="px-4 py-8 text-center font-semibold text-slate-500">Пока нет позиций</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="transition hover:bg-brand/[0.03]">
                  <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{item.name}</td>
                  <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{money(item.price)}</td>
                  {section.category === 'service' && (
                    <>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.lessons_count || '—'}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.validity_days ? `${item.validity_days} дн.` : '—'}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{formatScheduleDays(item.schedule_days) || '—'}</td>
                    </>
                  )}
                  <td className="border-b border-slate-100 px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {item.is_active ? 'Активен' : 'Отключен'}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3">
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="min-h-9 px-3 py-1.5" onClick={() => onEdit(item)}>
                          <Edit size={15} />
                          Изменить
                        </Button>
                        {item.is_active && (
                          <Button variant="secondary" className="min-h-9 px-3 py-1.5" onClick={() => onDisable(item)}>
                            <ToggleLeft size={15} />
                            Отключить
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
