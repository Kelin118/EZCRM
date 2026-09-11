import { BadgePercent, Ban, Building2, CheckCircle2, CreditCard, Edit, MessageSquare, Package, Plus, RotateCcw, Trash2, Upload, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import api from '../api/axios.js';
import { canDeleteSettings, canEditStudioSettings, canImportExcel, getStoredUser, isAdmin } from '../auth.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import Badge from '../components/ui/Badge.jsx';
import { ActionButton, PageHeader } from './pageUtils.jsx';
import { formatScheduleDays, weekdayOptions } from '../utils/subscriptionDates.js';
import { formatDiscountValue, normalizeDecimalString, parseDecimal } from '../utils/discounts.js';
import { loadMetaSdk, parseEmbeddedSignupMessage, startWhatsAppBusinessAppOnboarding } from '../utils/metaEmbeddedSignup.js';
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
  service_type: 'course',
  is_active: true,
  sort_order: 0,
};
const emptyBranchForm = { name: '', address: '', phone: '', description: '', is_active: true };
const emptyPaymentMethodForm = { name: '', code: '', description: '', is_cash: false, is_active: true, sort_order: 0 };
const emptyDiscountForm = { name: '', discount_type: 'percentage', value: '', branch: '', valid_from: '', valid_until: '', description: '', is_active: true };
const emptyChannelForm = { provider: 'whatsapp', name: '', external_account_id: '', phone_number: '', branch: '', default_manager: '', is_active: true };

const catalogSections = [
  { category: 'service', title: 'Услуги', addLabel: 'Добавить услугу', modalCreate: 'Новая услуга', icon: Wrench },
  { category: 'product', title: 'Товары', addLabel: 'Добавить товар', modalCreate: 'Новый товар', icon: Package },
  { category: 'addon', title: 'Доплаты к абонементам', addLabel: 'Добавить доплату', modalCreate: 'Новая доплата', icon: Plus },
  { category: 'extra_service', title: 'Доп. услуги', addLabel: 'Добавить доп. услугу', modalCreate: 'Новая доп. услуга', icon: Wrench },
];

const settingsNav = [
  { id: 'studio-settings', label: 'Основные' },
  { id: 'branches-settings', label: 'Филиалы' },
  { id: 'payments-settings', label: 'Оплата' },
  { id: 'integrations-settings', label: 'Интеграции' },
  { id: 'discounts-settings', label: 'Скидки' },
  ...catalogSections.map((section) => ({ id: `${section.category}-settings`, label: section.title })),
  { id: 'import-settings', label: 'Импорт', importOnly: true },
];

const selectClassName = 'min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/10';
const checkboxClassName = 'h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand';

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
  const canEditChannels = isAdmin(user);
  const canDeleteSettingsRecords = canDeleteSettings(user);
  const canImport = canImportExcel(user);
  const [settings, setSettings] = useState(empty);
  const [settingsId, setSettingsId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogImageSaving, setCatalogImageSaving] = useState(false);
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
  const [channels, setChannels] = useState([]);
  const [integrationStatus, setIntegrationStatus] = useState(null);
  const [channelModal, setChannelModal] = useState({ open: false, item: null });
  const [channelForm, setChannelForm] = useState(emptyChannelForm);
  const [managerOptions, setManagerOptions] = useState([]);
  const [embeddedSignup, setEmbeddedSignup] = useState({ code: '', waba_id: '', phone_number_id: '', business_id: '', message: '', error: '', success: null, phone_numbers: [] });
  const [embeddedBranch, setEmbeddedBranch] = useState('');
  const [embeddedManager, setEmbeddedManager] = useState('');
  const [embeddedConnecting, setEmbeddedConnecting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, title: '', itemName: '', endpoint: '', onDeleted: null });
  const [deleteSaving, setDeleteSaving] = useState(false);
  const completeStartedRef = useRef(false);

  const activeSection = useMemo(
    () => catalogSections.find((section) => section.category === catalogModal.category) || catalogSections[0],
    [catalogModal.category],
  );
  const visibleNavItems = useMemo(
    () => settingsNav.filter((item) => !item.importOnly || canImport),
    [canImport],
  );

  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
    loadChannels();
    loadManagers();
  }, []);

  useEffect(() => {
    if (!canEditChannels || !integrationStatus?.public_config?.app_id) return;
    loadMetaSdk(integrationStatus.public_config).catch(() => {
      setEmbeddedSignup((current) => ({ ...current, error: 'Не удалось загрузить Meta SDK.' }));
    });
  }, [canEditChannels, integrationStatus?.public_config?.app_id, integrationStatus?.public_config?.graph_api_version]);

  useEffect(() => {
    const handleMessage = (event) => {
      const payload = parseEmbeddedSignupMessage(event);
      if (!payload) return;
      const eventName = payload.event;
      if (eventName === 'CANCEL') {
        setEmbeddedConnecting(false);
        completeStartedRef.current = false;
        setEmbeddedSignup((current) => ({ ...current, message: 'Подключение WhatsApp отменено.', error: '', success: false }));
        return;
      }
      if (eventName === 'ERROR') {
        setEmbeddedConnecting(false);
        completeStartedRef.current = false;
        setEmbeddedSignup((current) => ({ ...current, error: payload.data?.error_message || payload.data?.message || 'Meta вернула ошибку подключения WhatsApp.', message: '', success: false }));
        return;
      }
      if (eventName === 'FINISH' || eventName === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        setEmbeddedSignup((current) => ({
          ...current,
          waba_id: payload.data?.waba_id || current.waba_id,
          phone_number_id: payload.data?.phone_number_id || current.phone_number_id,
          business_id: payload.data?.business_id || current.business_id,
          message: 'Meta подтвердила номер. Завершаем подключение...',
          error: '',
        }));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const completeEmbeddedSignup = async () => {
      if (!embeddedConnecting || completeStartedRef.current || !embeddedSignup.code || !embeddedSignup.waba_id) return;
      completeStartedRef.current = true;
      try {
        const { data } = await api.post('integrations/meta/embedded-signup/complete/', {
          code: embeddedSignup.code,
          waba_id: embeddedSignup.waba_id,
          phone_number_id: embeddedSignup.phone_number_id || null,
          business_id: embeddedSignup.business_id || null,
          branch: embeddedBranch || null,
          default_manager: embeddedManager || null,
        });
        setEmbeddedConnecting(false);
        setEmbeddedSignup((current) => ({
          ...current,
          message: `WhatsApp Business подключён. Номер: ${data.phone_number || data.verified_name || data.phone_number_id}. Входящие сообщения будут появляться в разделе Обращения.`,
          error: '',
          success: true,
          phone_numbers: [],
        }));
        await loadChannels();
      } catch (error) {
        setEmbeddedConnecting(false);
        completeStartedRef.current = false;
        if (error.response?.status === 409 && Array.isArray(error.response?.data?.phone_numbers)) {
          setEmbeddedSignup((current) => ({
            ...current,
            message: error.response.data.detail || 'Выберите номер WhatsApp.',
            error: '',
            success: false,
            phone_numbers: error.response.data.phone_numbers,
          }));
          return;
        }
        setEmbeddedSignup((current) => ({
          ...current,
          error: getApiErrorMessage(error),
          message: '',
          success: false,
        }));
      }
    };
    completeEmbeddedSignup();
  }, [embeddedConnecting, embeddedSignup.code, embeddedSignup.waba_id, embeddedSignup.phone_number_id, embeddedSignup.business_id, embeddedBranch, embeddedManager]);

  const loadManagers = async () => {
    const { data } = await api.get('users/staff-options/', { params: { role: 'manager', active: '1' } });
    const list = Array.isArray(data) ? data : data.results || [];
    setManagerOptions(list.map((item) => ({ value: String(item.id), label: item.display_name || item.full_name || item.username })));
  };

  const startEmbeddedSignup = () => {
    const publicConfig = integrationStatus?.public_config;
    if (!publicConfig?.app_id || !publicConfig?.whatsapp_config_id) {
      setEmbeddedSignup((current) => ({ ...current, error: 'Meta App ID или WhatsApp Config ID не настроены.', message: '', success: false }));
      return;
    }
    completeStartedRef.current = false;
    setEmbeddedConnecting(true);
    setEmbeddedSignup({ code: '', waba_id: '', phone_number_id: '', business_id: '', message: 'Откройте окно Meta и завершите подключение WhatsApp Business.', error: '', success: null, phone_numbers: [] });
    try {
      startWhatsAppBusinessAppOnboarding(publicConfig, (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setEmbeddedConnecting(false);
          completeStartedRef.current = false;
          setEmbeddedSignup((current) => ({ ...current, error: 'Meta не вернула authorization code.', message: '', success: false }));
          return;
        }
        setEmbeddedSignup((current) => ({ ...current, code, error: '', message: current.waba_id ? 'Завершаем подключение…' : 'Meta авторизация получена. Ждём данные WhatsApp Business…' }));
      });
    } catch {
      setEmbeddedConnecting(false);
      setEmbeddedSignup((current) => ({ ...current, error: 'Meta SDK ещё не готов. Попробуйте через несколько секунд.', message: '', success: false }));
    }
  };

  const selectEmbeddedPhoneNumber = (phoneNumberId) => {
    completeStartedRef.current = false;
    setEmbeddedConnecting(true);
    setEmbeddedSignup((current) => ({ ...current, phone_number_id: phoneNumberId, phone_numbers: [], message: 'Завершаем подключение выбранного номера…', error: '' }));
  };

  const showSuccess = (message) => {
    window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
  };

  const showError = (message) => {
    window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
  };

  const requestDelete = ({ title, itemName, endpoint, onDeleted }) => {
    setDeleteConfirm({ open: true, title, itemName, endpoint, onDeleted });
  };

  const closeDeleteConfirm = () => {
    if (deleteSaving) return;
    setDeleteConfirm({ open: false, title: '', itemName: '', endpoint: '', onDeleted: null });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm.endpoint || deleteSaving) return;
    setDeleteSaving(true);
    try {
      await api.delete(deleteConfirm.endpoint);
      await deleteConfirm.onDeleted?.();
      setDeleteConfirm({ open: false, title: '', itemName: '', endpoint: '', onDeleted: null });
      showSuccess('Запись удалена.');
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setDeleteSaving(false);
    }
  };

  const loadChannels = async () => {
    try {
      const [channelsResponse, statusResponse] = await Promise.all([
        api.get('messaging-channels/'),
        api.get('integrations/meta/status/'),
      ]);
      setChannels(Array.isArray(channelsResponse.data) ? channelsResponse.data : channelsResponse.data.results || []);
      setIntegrationStatus(statusResponse.data);
    } catch {
      setChannels([]);
      setIntegrationStatus(null);
    }
  };

  const saveChannel = async () => {
    const payload = {
      ...channelForm,
      branch: channelForm.branch || null,
      default_manager: channelForm.default_manager || null,
    };
    if (channelModal.item?.id) await api.patch(`messaging-channels/${channelModal.item.id}/`, payload);
    else await api.post('messaging-channels/', payload);
    setChannelModal({ open: false, item: null });
    setChannelForm(emptyChannelForm);
    await loadChannels();
  };

  const loadDiscounts = async () => {
    const { data } = await api.get('discounts/');
    setDiscounts(Array.isArray(data) ? data : data.results || []);
  };

  const saveDiscount = async () => {
    const normalizedValue = normalizeDecimalString(discountForm.value);
    const maxDecimals = discountForm.discount_type === 'percentage' ? 5 : 2;
    const decimalPattern = new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`);
    if (!decimalPattern.test(normalizedValue)) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: `Укажите корректное значение скидки: больше 0, до ${maxDecimals} знаков после запятой.` }));
      return;
    }
    const numericValue = parseDecimal(normalizedValue);
    if (numericValue <= 0) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: `Укажите корректное значение скидки: больше 0, до ${maxDecimals} знаков после запятой.` }));
      return;
    }
    if (discountForm.discount_type === 'percentage' && numericValue > 100) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: 'Процентная скидка не может быть больше 100%.' }));
      return;
    }
    const payload = {
      ...discountForm,
      value: normalizedValue,
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

  const toggleBranch = async (branch) => {
    await api.patch(`branches/${branch.id}/`, { is_active: !branch.is_active });
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
        ? { name: item.name ?? '', price: item.price ?? '', lessons_count: item.lessons_count ?? '', validity_days: item.validity_days ?? '', schedule_days: Array.isArray(item.schedule_days) ? [...item.schedule_days] : [], service_type: item.service_type || 'course', is_active: item.is_active ?? true, sort_order: item.sort_order ?? 0 }
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
      service_type: catalogModal.category === 'service' ? catalogForm.service_type : 'course',
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

  const toggleCatalogItem = async (item) => {
    await api.patch(`catalog-items/${item.id}/`, { is_active: !item.is_active });
    await loadCatalogItems();
  };

  const refreshCatalogItem = async (id) => {
    const { data } = await api.get(`catalog-items/${id}/`);
    setCatalogItems((items) => items.map((item) => (item.id === data.id ? data : item)));
    setCatalogModal((current) => current.item?.id === data.id ? { ...current, item: data } : current);
    return data;
  };

  const uploadCatalogImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !catalogModal.item?.id) return;
    const formData = new FormData();
    formData.append('file', file);
    setCatalogImageSaving(true);
    try {
      await api.post(`catalog-items/${catalogModal.item.id}/images/`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refreshCatalogItem(catalogModal.item.id);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setCatalogImageSaving(false);
    }
  };

  const deleteCatalogImage = async (imageId) => {
    if (!catalogModal.item?.id) return;
    setCatalogImageSaving(true);
    try {
      await api.delete(`catalog-items/${catalogModal.item.id}/images/${imageId}/`);
      await refreshCatalogItem(catalogModal.item.id);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setCatalogImageSaving(false);
    }
  };

  const makePrimaryCatalogImage = async (imageId) => {
    if (!catalogModal.item?.id) return;
    setCatalogImageSaving(true);
    try {
      await api.patch(`catalog-items/${catalogModal.item.id}/images/${imageId}/`, { is_primary: true });
      await refreshCatalogItem(catalogModal.item.id);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setCatalogImageSaving(false);
    }
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
      <PageHeader title="Настройки">
        <Badge value="active">{branches.filter((branch) => branch.is_active).length} филиалов</Badge>
        <Badge value="planned">{paymentMethods.filter((item) => item.is_active).length} способов оплаты</Badge>
        <Badge value={integrationStatus?.webhook_configured ? 'active' : 'today'}>
          {integrationStatus?.webhook_configured ? 'Webhook настроен' : 'Webhook требует внимания'}
        </Badge>
      </PageHeader>

      <div className="grid max-w-7xl min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <SettingsNavigation items={visibleNavItems} onSelect={scrollToSection} />
        <div className="min-w-0 space-y-5">
      <form onSubmit={save}>
        <SettingsCard id="studio-settings" icon={Building2} title="Информация студии" subtitle="Контакты и базовые параметры CRM">
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

        <SettingsCard
          id="branches-settings"
          icon={Building2}
          title="Филиалы"
          subtitle="Подразделения учебного центра"
          action={canEditStudio && (
            <Button onClick={() => { setBranchForm(emptyBranchForm); setBranchModal({ open: true, item: null }); }}>
              <Plus size={16} />Добавить филиал
            </Button>
          )}
        >
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">Название</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Адрес</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Телефон</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Статус</th><th className="border-b border-slate-100 px-4 py-3 text-right font-bold">Действия</th>
              </tr></thead>
              <tbody>{branches.length ? branches.map((branch) => <tr key={branch.id} className="transition hover:bg-brand/[0.03]">
                <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{branch.name}</td><td className="max-w-xs break-words border-b border-slate-100 px-4 py-3 text-slate-700">{branch.address || '—'}</td><td className="border-b border-slate-100 px-4 py-3 text-slate-700">{branch.phone || '—'}</td>
                <td className="border-b border-slate-100 px-4 py-3"><StatusBadge active={branch.is_active} /></td>
                <td className="border-b border-slate-100 px-4 py-3"><RowActions canEdit={canEditStudio} canDelete={canDeleteSettingsRecords} active={branch.is_active} onEdit={() => { setBranchForm({ ...emptyBranchForm, ...branch, is_active: branch.is_active ?? true }); setBranchModal({ open: true, item: branch }); }} onToggle={() => toggleBranch(branch)} onDelete={() => requestDelete({ title: 'Удалить филиал?', itemName: branch.name, endpoint: `branches/${branch.id}/`, onDeleted: loadBranches })} /></td>
              </tr>) : <EmptyTableRow colSpan={5} message="Филиалы ещё не добавлены" />}</tbody>
            </table>
          </div>
        </SettingsCard>
        <SettingsCard
          id="payments-settings"
          icon={CreditCard}
          title="Способы оплаты"
          subtitle="Доступные способы при оформлении оплат"
          action={canEditCatalog && <Button onClick={() => { setPaymentMethodForm(emptyPaymentMethodForm); setPaymentMethodModal({ open: true, item: null }); }}><Plus size={16} />Добавить способ оплаты</Button>}
        >
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="border-b border-slate-100 px-4 py-3 font-bold">Название</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Описание</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Наличные</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Статус</th><th className="border-b border-slate-100 px-4 py-3 text-right font-bold">Действия</th></tr></thead>
              <tbody>{paymentMethods.length ? paymentMethods.map((item) => <tr key={item.id} className="transition hover:bg-brand/[0.03]">
                <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{item.name}</td><td className="max-w-sm break-words border-b border-slate-100 px-4 py-3 text-slate-700">{item.description || '—'}</td><td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.is_cash ? 'Да' : 'Нет'}</td><td className="border-b border-slate-100 px-4 py-3"><StatusBadge active={item.is_active} /></td>
                <td className="border-b border-slate-100 px-4 py-3"><RowActions canEdit={canEditCatalog} canDelete={canDeleteSettingsRecords} active={item.is_active} onEdit={() => { setPaymentMethodForm({ ...emptyPaymentMethodForm, ...item, is_cash: item.is_cash ?? false, is_active: item.is_active ?? true, sort_order: item.sort_order ?? 0 }); setPaymentMethodModal({ open: true, item }); }} onToggle={() => togglePaymentMethod(item)} onDelete={() => requestDelete({ title: 'Удалить способ оплаты?', itemName: item.name, endpoint: `payment-methods/${item.id}/`, onDeleted: refreshPaymentMethods })} /></td>
              </tr>) : <EmptyTableRow colSpan={5} message="Способы оплаты ещё не добавлены" />}</tbody>
            </table>
          </div>
        </SettingsCard>
        <SettingsCard id="integrations-settings" icon={MessageSquare} title="Интеграции с мессенджерами" subtitle="Официальные Meta Webhooks для WhatsApp и Instagram">
          {integrationStatus && (
            <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <IntegrationStatusCard
                label="Meta"
                ok={integrationStatus.app_id_configured && integrationStatus.embedded_signup_configured}
                okText="App ID и signup настроены"
                warnText="Нужно заполнить env"
              />
              <IntegrationStatusCard
                label="Webhook"
                ok={integrationStatus.webhook_configured}
                okText="Verify token настроен"
                warnText="Verify token не задан"
              />
              <IntegrationStatusCard
                label="App Secret"
                ok={integrationStatus.app_secret_configured}
                okText="Подпись включена"
                warnText="Secret не задан"
              />
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Каналы</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">WhatsApp: {integrationStatus.whatsapp?.channel_count || 0}</p>
                <p className="text-sm font-semibold text-slate-900">Instagram: {integrationStatus.instagram?.channel_count || 0}</p>
              </div>
            </div>
          )}
          {canEditChannels && (
            <div className="mb-4 rounded-[24px] border border-brand/15 bg-brand/5 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Подключить WhatsApp Business</h3>
                  <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
                    Подключает существующий номер WhatsApp Business к CRM. WhatsApp на телефоне продолжит работать.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      Филиал
                      <select
                        value={embeddedBranch}
                        onChange={(event) => setEmbeddedBranch(event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">Не распределено</option>
                        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      Менеджер по умолчанию
                      <select
                        value={embeddedManager}
                        onChange={(event) => setEmbeddedManager(event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">Не назначен</option>
                        {managerOptions.map((manager) => <option key={manager.value} value={manager.value}>{manager.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                <Button
                  className="min-w-64 self-start"
                  onClick={startEmbeddedSignup}
                  disabled={embeddedConnecting || !integrationStatus?.app_id_configured || !integrationStatus?.embedded_signup_configured}
                >
                  {embeddedConnecting ? 'Подключение…' : 'Подключить WhatsApp Business'}
                </Button>
              </div>
              {!integrationStatus?.app_id_configured || !integrationStatus?.embedded_signup_configured ? (
                <p className="mt-3 text-sm font-semibold text-amber-700">Укажите META_APP_ID и META_WHATSAPP_CONFIG_ID в backend env.</p>
              ) : null}
              {embeddedSignup.message && <div className={`mt-3 rounded-2xl px-4 py-3 text-sm font-semibold ${embeddedSignup.success ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-700'}`}>{embeddedSignup.message}</div>}
              {embeddedSignup.error && <div className="mt-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{embeddedSignup.error}</div>}
              {embeddedSignup.phone_numbers.length > 0 && (
                <div className="mt-3 grid gap-2 rounded-2xl bg-white p-3 text-sm">
                  <p className="font-black text-slate-900">Выберите номер WhatsApp</p>
                  {embeddedSignup.phone_numbers.map((phoneNumber) => (
                    <button
                      type="button"
                      key={phoneNumber.id}
                      onClick={() => selectEmbeddedPhoneNumber(phoneNumber.id)}
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-left font-semibold text-slate-700 transition hover:border-brand/40 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10"
                    >
                      {phoneNumber.verified_name || phoneNumber.display_phone_number || phoneNumber.id}
                      {phoneNumber.display_phone_number && phoneNumber.verified_name ? <span className="ml-2 text-slate-400">{phoneNumber.display_phone_number}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canEditChannels && <div className="mb-4 flex justify-end"><Button onClick={() => { setChannelForm(emptyChannelForm); setChannelModal({ open: true, item: null }); }}><Plus size={16} />Добавить канал</Button></div>}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="border-b border-slate-100 px-4 py-3 font-bold">Источник</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Название</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Account ID</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Номер</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Филиал</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Менеджер</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Последний webhook</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Статус</th><th className="border-b border-slate-100 px-4 py-3 text-right font-bold">Действия</th></tr></thead>
              <tbody>{channels.length ? channels.map((item) => <tr key={item.id} className="transition hover:bg-brand/[0.03]">
                <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{item.provider_display || item.provider}</td>
                <td className="max-w-48 break-words border-b border-slate-100 px-4 py-3 text-slate-700">{item.name}</td>
                <td className="max-w-52 break-all border-b border-slate-100 px-4 py-3 font-mono text-xs text-slate-600">{item.external_account_id}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.phone_number || '—'}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.branch_name || '—'}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.default_manager_name || '—'}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.last_webhook_at ? new Date(item.last_webhook_at).toLocaleString('ru-RU') : '—'}</td>
                <td className="border-b border-slate-100 px-4 py-3">
                  <div className="grid gap-1">
                    <StatusBadge active={item.is_active} />
                    {item.last_error ? <span className="max-w-64 break-words text-xs font-semibold text-red-700">{item.last_error}</span> : null}
                  </div>
                </td>
                <td className="border-b border-slate-100 px-4 py-3"><RowActions canEdit={canEditChannels} canDelete={canDeleteSettingsRecords} active={item.is_active} onEdit={() => { setChannelForm({ ...emptyChannelForm, ...item, branch: item.branch ? String(item.branch) : '', default_manager: item.default_manager ? String(item.default_manager) : '' }); setChannelModal({ open: true, item }); }} onToggle={async () => { await api.patch(`messaging-channels/${item.id}/`, { is_active: !item.is_active }); await loadChannels(); }} onDelete={() => requestDelete({ title: 'Удалить канал?', itemName: item.name, endpoint: `messaging-channels/${item.id}/`, onDeleted: loadChannels })} /></td>
              </tr>) : <EmptyTableRow colSpan={9} message="Каналы мессенджеров ещё не добавлены" />}</tbody>
            </table>
          </div>
        </SettingsCard>
        <SettingsCard
          id="discounts-settings"
          icon={BadgePercent}
          title="Скидки"
          subtitle="Процентные и фиксированные скидки для продаж"
          action={canEditCatalog && <Button onClick={() => { setDiscountForm(emptyDiscountForm); setDiscountModal({ open: true, item: null }); }}><Plus size={16} />Добавить скидку</Button>}
        >
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
                <th className="border-b border-slate-100 px-4 py-3 font-bold">Название</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Тип</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Значение</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Филиал</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Действует</th><th className="border-b border-slate-100 px-4 py-3 font-bold">Статус</th><th className="border-b border-slate-100 px-4 py-3 text-right font-bold">Действия</th>
              </tr></thead>
              <tbody>{discounts.length ? discounts.map((item) => <tr key={item.id} className="transition hover:bg-brand/[0.03]">
                <td className="max-w-64 break-words border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{item.name}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.discount_type === 'percentage' ? 'Процент' : 'Фикс.'}</td>
                <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{item.discount_type === 'percentage' ? `${formatDiscountValue(item.value)}%` : `${money(item.value)} ₸`}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.branch_name || 'Все филиалы'}</td>
                <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{[item.valid_from || '—', item.valid_until || '—'].join(' — ')}</td>
                <td className="border-b border-slate-100 px-4 py-3"><StatusBadge active={item.is_active} activeLabel="Активна" inactiveLabel="Отключена" /></td>
                <td className="border-b border-slate-100 px-4 py-3"><RowActions canEdit={canEditCatalog} canDelete={canDeleteSettingsRecords} active={item.is_active} onEdit={() => { setDiscountForm({ ...emptyDiscountForm, ...item, branch: item.branch ? String(item.branch) : '', value: item.value ?? '' }); setDiscountModal({ open: true, item }); }} onToggle={() => toggleDiscount(item)} onDelete={() => requestDelete({ title: 'Удалить скидку?', itemName: item.name, endpoint: `discounts/${item.id}/`, onDeleted: loadDiscounts })} /></td>
              </tr>) : <EmptyTableRow colSpan={7} message="Скидки ещё не добавлены" />}</tbody>
            </table>
          </div>
        </SettingsCard>
        {catalogSections.map((section) => (
          <CatalogSection
            key={section.category}
            id={`${section.category}-settings`}
            section={section}
            items={catalogItems.filter((item) => item.category === section.category)}
            loading={catalogLoading}
            canEdit={canEditCatalog}
            canDelete={canDeleteSettingsRecords}
            onAdd={() => openCatalogModal(section.category)}
            onEdit={(item) => openCatalogModal(section.category, item)}
            onToggle={toggleCatalogItem}
            onDelete={(item) => requestDelete({ title: 'Удалить позицию?', itemName: item.name, endpoint: `catalog-items/${item.id}/`, onDeleted: loadCatalogItems })}
          />
        ))}

      {canImport && <section id="import-settings" className="scroll-mt-24 rounded-[24px] border border-slate-100 bg-white p-6 shadow-card">
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
            {importing ? 'Импорт…' : 'Импортировать'}
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
                <p className="text-sm font-bold text-amber-900">Предупреждения</p>
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
        </div>
      </div>

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
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className={checkboxClassName} checked={paymentMethodForm.is_cash} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, is_cash: event.target.checked })} />Наличные</label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className={checkboxClassName} checked={paymentMethodForm.is_active} onChange={(event) => setPaymentMethodForm({ ...paymentMethodForm, is_active: event.target.checked })} />Активен</label>
        </div>
      </Modal>

      <Modal
        title={channelModal.item ? 'Изменить канал мессенджера' : 'Новый канал мессенджера'}
        open={channelModal.open}
        onClose={() => setChannelModal({ open: false, item: null })}
        footer={<><Button variant="secondary" onClick={() => setChannelModal({ open: false, item: null })}>Отмена</Button><Button onClick={saveChannel}>Сохранить</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Источник
            <select className={selectClassName} value={channelForm.provider} onChange={(event) => setChannelForm({ ...channelForm, provider: event.target.value })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <Input label="Название" value={channelForm.name} onChange={(event) => setChannelForm({ ...channelForm, name: event.target.value })} />
          <Input label="External Account ID" value={channelForm.external_account_id} onChange={(event) => setChannelForm({ ...channelForm, external_account_id: event.target.value })} />
          <Input label="Номер WhatsApp" value={channelForm.phone_number || ''} onChange={(event) => setChannelForm({ ...channelForm, phone_number: event.target.value })} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Филиал
            <select className={selectClassName} value={channelForm.branch || ''} onChange={(event) => setChannelForm({ ...channelForm, branch: event.target.value })}>
              <option value="">Без филиала</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Менеджер по умолчанию
            <select className={selectClassName} value={channelForm.default_manager || ''} onChange={(event) => setChannelForm({ ...channelForm, default_manager: event.target.value })}>
              <option value="">Не назначен</option>
              {managerOptions.map((manager) => <option key={manager.value} value={manager.value}>{manager.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className={checkboxClassName} checked={channelForm.is_active} onChange={(event) => setChannelForm({ ...channelForm, is_active: event.target.checked })} />Активен</label>
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
            <select value={discountForm.discount_type} onChange={(event) => setDiscountForm({ ...discountForm, discount_type: event.target.value })} className={selectClassName}>
              <option value="percentage">Процентная</option>
              <option value="fixed">Фиксированная</option>
            </select>
          </label>
          <Input label={discountForm.discount_type === 'percentage' ? 'Значение, %' : 'Значение, ₸'} type="text" inputMode="decimal" value={discountForm.value} onChange={(event) => setDiscountForm({ ...discountForm, value: event.target.value })} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Филиал
            <select value={discountForm.branch || ''} onChange={(event) => setDiscountForm({ ...discountForm, branch: event.target.value })} className={selectClassName}>
              <option value="">Все филиалы</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <Input label="Действует с" type="date" value={discountForm.valid_from || ''} onChange={(event) => setDiscountForm({ ...discountForm, valid_from: event.target.value })} />
          <Input label="Действует до" type="date" value={discountForm.valid_until || ''} onChange={(event) => setDiscountForm({ ...discountForm, valid_until: event.target.value })} />
          <Input label="Описание" className="md:col-span-2" value={discountForm.description || ''} onChange={(event) => setDiscountForm({ ...discountForm, description: event.target.value })} />
          <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className={checkboxClassName} checked={discountForm.is_active} onChange={(event) => setDiscountForm({ ...discountForm, is_active: event.target.checked })} />Активна</label>
        </div>
      </Modal>

      <Modal
        title={catalogModal.item ? `Изменить: ${catalogModal.item.name}` : activeSection.modalCreate}
        open={catalogModal.open}
        onClose={closeCatalogModal}
        footer={
          <>
            <Button variant="secondary" onClick={() => closeCatalogModal()} disabled={catalogSaving}>Отмена</Button>
            <Button onClick={saveCatalogItem} disabled={catalogSaving}>{catalogSaving ? 'Сохранение…' : 'Сохранить'}</Button>
          </>
        }
      >
        {catalogError && <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{catalogError}</div>}
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Наименование" value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} />
          <Input label="Цена" type="number" min="0" value={catalogForm.price} onChange={(event) => setCatalogForm({ ...catalogForm, price: event.target.value })} />
          <Input label="Порядок" type="number" min="0" value={catalogForm.sort_order ?? 0} onChange={(event) => setCatalogForm({ ...catalogForm, sort_order: event.target.value })} />
          {catalogModal.category === 'product' && catalogModal.item?.id && (
            <div className="grid gap-3 md:col-span-2">
              <Input label="Фото товара" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadCatalogImage} />
              <div className="grid gap-3 sm:grid-cols-2">
                {(catalogModal.item.images || []).map((image) => (
                  <div key={image.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <img src={image.thumbnail_url || image.url} alt={image.file_name} className="h-32 w-full rounded-xl object-cover" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant={image.is_primary ? 'accent' : 'secondary'} disabled={catalogImageSaving || image.is_primary} onClick={() => makePrimaryCatalogImage(image.id)}>
                        {image.is_primary ? 'Основное' : 'Сделать основным'}
                      </Button>
                      <Button variant="danger" disabled={catalogImageSaving} onClick={() => deleteCatalogImage(image.id)}>Удалить</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {catalogModal.category === 'service' && (
            <>
              <label className="block text-sm font-semibold text-slate-700">
                Тип услуги
                <select
                  className={selectClassName}
                  value={catalogForm.service_type}
                  onChange={(event) => setCatalogForm({ ...catalogForm, service_type: event.target.value })}
                >
                  <option value="course">Учебный курс</option>
                  <option value="camp">Лагерь</option>
                </select>
              </label>
              <Input label="Количество занятий" type="number" min="0" value={catalogForm.lessons_count} onChange={(event) => setCatalogForm({ ...catalogForm, lessons_count: event.target.value })} />
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
                className={checkboxClassName}
              />
              Активен
            </label>
          )}
        </div>
      </Modal>

      <Modal
        title={deleteConfirm.title}
        open={deleteConfirm.open}
        onClose={closeDeleteConfirm}
        footer={
          <>
            <Button variant="secondary" onClick={closeDeleteConfirm} disabled={deleteSaving}>Отмена</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteSaving}>
              <Trash2 size={16} />
              {deleteSaving ? 'Удаление…' : 'Удалить'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm text-slate-700">
          <p>Будет удалена запись:</p>
          <p className="break-words rounded-2xl bg-slate-50 px-4 py-3 font-semibold text-slate-900">{deleteConfirm.itemName}</p>
          <p>Действие необратимо. Если запись уже используется, сервер вернёт причину и окно останется открытым.</p>
        </div>
      </Modal>
    </>
  );
}

function SettingsNavigation({ items, onSelect }) {
  return (
    <nav className="min-w-0 overflow-hidden lg:sticky lg:top-4" aria-label="Разделы настроек">
      <div className="-mx-1 flex w-full gap-2 overflow-x-auto px-1 pb-2 scrollbar-thin lg:mx-0 lg:grid lg:gap-1 lg:overflow-visible lg:rounded-2xl lg:border lg:border-slate-100 lg:bg-white lg:p-2 lg:shadow-card">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="min-h-10 shrink-0 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-600 transition hover:bg-brand/5 hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10 lg:w-full"
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function IntegrationStatusCard({ label, ok, okText, warnText }) {
  return (
    <div className={`rounded-2xl border p-4 ${ok ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/70'}`}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className={ok ? 'text-emerald-700' : 'text-amber-700'} size={18} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-1 text-sm font-semibold ${ok ? 'text-emerald-800' : 'text-amber-800'}`}>{ok ? okText : warnText}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ active, activeLabel = 'Активен', inactiveLabel = 'Отключён' }) {
  return <Badge value={active ? 'active' : 'cancelled'}>{active ? activeLabel : inactiveLabel}</Badge>;
}

function EmptyTableRow({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center font-semibold text-slate-500">{message}</td>
    </tr>
  );
}

function RowActions({ canEdit, canDelete = canEdit, active, onEdit, onToggle, onDelete }) {
  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex justify-end gap-2">
      {canEdit && <ActionButton icon={Edit} label="Изменить" onClick={onEdit} />}
      {canEdit && <ActionButton icon={active ? Ban : RotateCcw} label={active ? 'Отключить' : 'Включить'} onClick={onToggle} variant="ghost" />}
      {canDelete && <ActionButton icon={Trash2} label="Удалить" onClick={onDelete} variant="danger" />}
    </div>
  );
}

function SettingsCard({ id, icon: Icon, title, subtitle, action, children }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[24px] border border-slate-100 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/45 text-slate-900">
            <Icon size={21} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</p>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function CatalogSection({ id, section, items, loading, canEdit, canDelete, onAdd, onEdit, onToggle, onDelete }) {
  const Icon = section.icon;

  return (
    <section id={id} className="scroll-mt-24 rounded-[24px] border border-slate-100 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
            <Icon size={21} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900">{section.title}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-500">Позиции справочника цен для продаж и оплат</p>
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
                  <th className="border-b border-slate-100 px-4 py-3 font-bold">Тип услуги</th>
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
              <EmptyTableRow colSpan={section.category === 'service' ? 8 : 4} message="Загрузка…" />
            ) : items.length === 0 ? (
              <EmptyTableRow colSpan={section.category === 'service' ? 8 : 4} message="Пока нет позиций" />
            ) : (
              items.map((item) => (
                <tr key={item.id} className="transition hover:bg-brand/[0.03]">
                  <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">
                    <div className="flex items-center gap-3">
                      {section.category === 'product' && item.primary_image_url && <img src={item.primary_image_url} alt="" className="h-11 w-11 rounded-xl object-cover" />}
                      <span>{item.name}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{money(item.price)}</td>
                  {section.category === 'service' && (
                    <>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.service_type === 'camp' ? 'Лагерь' : 'Основной курс'}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.lessons_count || '—'}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{item.validity_days ? `${item.validity_days} дн.` : '—'}</td>
                      <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{formatScheduleDays(item.schedule_days) || '—'}</td>
                    </>
                  )}
                  <td className="border-b border-slate-100 px-4 py-3">
                    <StatusBadge active={item.is_active} />
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3">
                    <RowActions canEdit={canEdit} canDelete={canDelete} active={item.is_active} onEdit={() => onEdit(item)} onToggle={() => onToggle(item)} onDelete={() => onDelete(item)} />
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
