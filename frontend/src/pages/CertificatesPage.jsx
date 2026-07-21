import { toBlob } from 'html-to-image';
import { Download, Eye, Gift, MessageCircle, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import api from '../api/axios.js';
import CertificateCard from '../components/certificates/CertificateCard.jsx';
import PaymentSplitFields, { paymentPartsPayload, paymentPartsTotal } from '../components/finance/PaymentSplitFields.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import { Actions, Badge, Filters, Input, money, PageHeader, SelectField, showApiError, Table } from './pageUtils.jsx';
import { useClientOptions } from './lookupUtils.jsx';
import { certificateWhatsappUrl, normalizeWhatsappPhone } from '../utils/whatsapp.js';

const emptyTemplate = {
  name: '',
  title: 'Подарочный сертификат',
  subtitle: 'Для оплаты услуг центра',
  description: '',
  amount_type: 'fixed',
  fixed_amount: 10000,
  min_amount: 10000,
  max_amount: 50000,
  validity_days: 365,
  sale_discount_percent: 0,
  background_from: '#fff7ed',
  background_to: '#fde68a',
  accent_color: '#f59e0b',
  text_color: '#1f2937',
  badge_text: 'Подарочный сертификат',
  terms: '',
  background_image_url: '',
  is_active: true,
};

const emptyCertificate = {
  template: '',
  purchaser_client: '',
  recipient_name: '',
  recipient_phone: '',
  face_value: '',
  issued_at: new Date().toISOString().slice(0, 10),
  payment_parts: [],
};

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'Активен' },
  { value: 'partially_used', label: 'Частично использован' },
  { value: 'used', label: 'Использован' },
  { value: 'expired', label: 'Просрочен' },
  { value: 'cancelled', label: 'Отменён' },
];

function dispatchError(message) {
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}

function dispatchSuccess(message) {
  window.dispatchEvent(new CustomEvent('api-success', { detail: message }));
}

function salePrice(faceValue, template) {
  const discount = Number(template?.sale_discount_percent || 0);
  return Math.round((Number(faceValue || 0) * (100 - discount))) / 100;
}

function certificatePublicUrl(certificate) {
  return `${window.location.origin}/certificate/${certificate.public_token}`;
}

export default function CertificatesPage() {
  const [tab, setTab] = useState('certificates');
  const [templates, setTemplates] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', template: '', client: '' });
  const [loading, setLoading] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [certificateForm, setCertificateForm] = useState(emptyCertificate);
  const [selectedCertificate, setSelectedCertificate] = useState(null);
  const [redeemForm, setRedeemForm] = useState({ amount: '', comment: '' });
  const cardRef = useRef(null);
  const { clientOptions } = useClientOptions();

  const templateOptions = templates.map((item) => ({ value: String(item.id), label: item.name }));
  const selectedTemplate = templates.find((item) => String(item.id) === String(certificateForm.template));
  const calculatedSalePrice = salePrice(certificateForm.face_value, selectedTemplate);

  const loadTemplates = async () => {
    const { data } = await api.get('certificate-templates/');
    setTemplates(Array.isArray(data) ? data : data.results || []);
  };

  const loadCertificates = async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data } = await api.get('certificates/', { params });
      setCertificates(Array.isArray(data) ? data : data.results || []);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTemplates(); }, []);
  useEffect(() => { loadCertificates(); }, [JSON.stringify(filters)]);

  const saveTemplate = async () => {
    try {
      if (templateForm.id) await api.patch(`certificate-templates/${templateForm.id}/`, templateForm);
      else await api.post('certificate-templates/', templateForm);
      setTemplateModal(false);
      setTemplateForm(emptyTemplate);
      await loadTemplates();
      dispatchSuccess('Шаблон сертификата сохранён.');
    } catch (error) {
      showApiError(error);
    }
  };

  const disableTemplate = async (template) => {
    try {
      await api.delete(`certificate-templates/${template.id}/`);
      await loadTemplates();
    } catch (error) {
      showApiError(error);
    }
  };

  const openWizard = (template = null) => {
    setCertificateForm({
      ...emptyCertificate,
      template: template ? String(template.id) : '',
      face_value: template?.amount_type === 'fixed' ? template.fixed_amount : template?.min_amount || '',
      issued_at: new Date().toISOString().slice(0, 10),
      payment_parts: [],
    });
    setWizardStep(template ? 2 : 1);
    setWizardOpen(true);
  };

  const createCertificate = async () => {
    if (!certificateForm.template) return dispatchError('Выберите шаблон сертификата.');
    if (calculatedSalePrice > 0 && paymentPartsTotal(certificateForm.payment_parts) !== calculatedSalePrice) {
      return dispatchError('Сумма оплат по способам должна совпадать с ценой продажи сертификата.');
    }
    try {
      const payload = { ...certificateForm, payment_parts: paymentPartsPayload(certificateForm.payment_parts) };
      const { data } = await api.post('certificates/', payload);
      setWizardOpen(false);
      setWizardStep(1);
      setSelectedCertificate(data);
      await loadCertificates();
      dispatchSuccess('Сертификат создан.');
    } catch (error) {
      showApiError(error);
    }
  };

  const redeemCertificate = async () => {
    if (!selectedCertificate) return;
    try {
      const { data } = await api.post(`certificates/${selectedCertificate.id}/redeem/`, redeemForm);
      setSelectedCertificate(data.certificate);
      setRedeemForm({ amount: '', comment: '' });
      await loadCertificates();
      dispatchSuccess('Сертификат использован.');
    } catch (error) {
      showApiError(error);
    }
  };

  const cancelCertificate = async (certificate) => {
    try {
      const { data } = await api.post(`certificates/${certificate.id}/cancel/`);
      setCertificates((items) => items.map((item) => (item.id === data.id ? data : item)));
      if (selectedCertificate?.id === data.id) setSelectedCertificate(data);
    } catch (error) {
      showApiError(error);
    }
  };

  const downloadPng = async (certificate = selectedCertificate) => {
    if (!cardRef.current || !certificate) return;
    const blob = await toBlob(cardRef.current, { pixelRatio: 2, cacheBust: true });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `certificate-${certificate.code}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sharePng = async () => {
    if (!selectedCertificate || !cardRef.current) return;
    const publicUrl = certificatePublicUrl(selectedCertificate);
    const blob = await toBlob(cardRef.current, { pixelRatio: 2, cacheBust: true });
    const file = blob ? new File([blob], `certificate-${selectedCertificate.code}.png`, { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: selectedCertificate.code, text: publicUrl });
      return;
    }
    await downloadPng(selectedCertificate);
    dispatchSuccess('Изображение сертификата скачано. При необходимости прикрепите его к сообщению в WhatsApp.');
  };

  const openWhatsapp = async () => {
    if (!selectedCertificate) return;
    try {
      const phone = normalizeWhatsappPhone(selectedCertificate.recipient_phone);
      const publicUrl = certificatePublicUrl(selectedCertificate);
      window.open(certificateWhatsappUrl(selectedCertificate, publicUrl), '_blank', 'noopener,noreferrer');
      const { data } = await api.post(`certificates/${selectedCertificate.id}/mark-sent/`, { phone });
      setSelectedCertificate(data);
      await loadCertificates();
      dispatchSuccess('Открыто для отправки в WhatsApp. Подтвердите отправку вручную.');
    } catch (error) {
      dispatchError(error.message || 'Не удалось открыть WhatsApp.');
    }
  };

  const certificateColumns = useMemo(() => [
    { key: 'code', header: 'Код' },
    { key: 'recipient_name', header: 'Получатель' },
    { key: 'template_name', header: 'Шаблон' },
    { key: 'face_value', header: 'Номинал', render: (row) => money(row.face_value) },
    { key: 'remaining_amount', header: 'Остаток', render: (row) => money(row.remaining_amount) },
    { key: 'sale_price', header: 'Продажа', render: (row) => money(row.sale_price) },
    { key: 'valid_until', header: 'Действует до' },
    { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
    { key: 'actions', header: '', render: (row) => (
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="h-9 px-3" onClick={() => setSelectedCertificate(row)}><Eye size={15} />Открыть</Button>
        {row.status !== 'cancelled' && <Button variant="secondary" className="h-9 px-3" onClick={() => cancelCertificate(row)}><Trash2 size={15} />Отменить</Button>}
      </div>
    ) },
  ], [selectedCertificate]);

  return (
    <>
      <PageHeader title="Сертификаты" actionLabel="Оформить сертификат" onAction={() => openWizard()}>
        <Button variant="secondary" onClick={() => { setTemplateForm(emptyTemplate); setTemplateModal(true); }}><Plus size={16} />Добавить шаблон</Button>
      </PageHeader>

      <div className="mb-5 inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" onClick={() => setTab('certificates')} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'certificates' ? 'bg-brand text-white' : 'text-slate-600'}`}>Выданные сертификаты</button>
        <button type="button" onClick={() => setTab('templates')} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'templates' ? 'bg-brand text-white' : 'text-slate-600'}`}>Шаблоны</button>
      </div>

      {tab === 'certificates' ? (
        <>
          <Filters>
            <Input label="Поиск" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
            <SelectField label="Статус" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={statusOptions} />
            <SelectField label="Шаблон" value={filters.template} onChange={(value) => setFilters({ ...filters, template: value })} options={[{ value: '', label: 'Все шаблоны' }, ...templateOptions]} />
            <SelectField label="Клиент" value={filters.client} onChange={(value) => setFilters({ ...filters, client: value })} options={[{ value: '', label: 'Все клиенты' }, ...clientOptions]} />
          </Filters>
          {loading ? <div className="rounded-2xl bg-white p-8 text-center font-semibold text-slate-500">Загрузка...</div> : <Table data={certificates} columns={certificateColumns} />}
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="grid gap-3 rounded-[24px] border border-slate-100 bg-white p-4 shadow-card">
              <CertificateCard template={template} compact />
              <div>
                <h3 className="text-lg font-black text-slate-900">{template.name}</h3>
                <p className="text-sm text-slate-500">{template.description || template.subtitle}</p>
                <p className="mt-2 text-sm font-bold text-slate-700">
                  {template.amount_type === 'fixed' ? money(template.fixed_amount) : `${money(template.min_amount)} — ${money(template.max_amount)}`}
                </p>
                <p className="text-sm text-emerald-700">Скидка при покупке: {Number(template.sale_discount_percent || 0).toLocaleString('ru-RU')}%</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openWizard(template)} disabled={!template.is_active}><Gift size={16} />Оформить</Button>
                <Button variant="secondary" onClick={() => { setTemplateForm(template); setTemplateModal(true); }}>Изменить</Button>
                {template.is_active ? <Button variant="secondary" onClick={() => disableTemplate(template)}>Отключить</Button> : <Badge value="cancelled">Отключён</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={templateForm.id ? 'Изменить шаблон' : 'Новый шаблон'}
        open={templateModal}
        onClose={() => setTemplateModal(false)}
        footer={<><Button variant="secondary" onClick={() => setTemplateModal(false)}>Отмена</Button><Button onClick={saveTemplate}>Сохранить</Button></>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Название" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} />
          <Input label="Заголовок" value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} />
          <Input label="Подзаголовок" value={templateForm.subtitle} onChange={(e) => setTemplateForm({ ...templateForm, subtitle: e.target.value })} />
          <SelectField label="Тип номинала" value={templateForm.amount_type} onChange={(value) => setTemplateForm({ ...templateForm, amount_type: value })} options={[{ value: 'fixed', label: 'Фиксированный' }, { value: 'range', label: 'Диапазон' }]} />
          {templateForm.amount_type === 'fixed' ? (
            <Input label="Фиксированный номинал" type="number" value={templateForm.fixed_amount} onChange={(e) => setTemplateForm({ ...templateForm, fixed_amount: e.target.value })} />
          ) : (
            <>
              <Input label="Минимальный номинал" type="number" value={templateForm.min_amount} onChange={(e) => setTemplateForm({ ...templateForm, min_amount: e.target.value })} />
              <Input label="Максимальный номинал" type="number" value={templateForm.max_amount} onChange={(e) => setTemplateForm({ ...templateForm, max_amount: e.target.value })} />
            </>
          )}
          <Input label="Срок действия, дней" type="number" value={templateForm.validity_days} onChange={(e) => setTemplateForm({ ...templateForm, validity_days: e.target.value })} />
          <Input label="Скидка при покупке, %" inputMode="decimal" value={templateForm.sale_discount_percent} onChange={(e) => setTemplateForm({ ...templateForm, sale_discount_percent: e.target.value.replace(',', '.') })} />
          <Input label="Цвет фона от" type="color" value={templateForm.background_from} onChange={(e) => setTemplateForm({ ...templateForm, background_from: e.target.value })} />
          <Input label="Цвет фона до" type="color" value={templateForm.background_to} onChange={(e) => setTemplateForm({ ...templateForm, background_to: e.target.value })} />
          <Input label="Акцент" type="color" value={templateForm.accent_color} onChange={(e) => setTemplateForm({ ...templateForm, accent_color: e.target.value })} />
          <Input label="Цвет текста" type="color" value={templateForm.text_color} onChange={(e) => setTemplateForm({ ...templateForm, text_color: e.target.value })} />
          <Input label="Бейдж" value={templateForm.badge_text} onChange={(e) => setTemplateForm({ ...templateForm, badge_text: e.target.value })} />
          <Input label="URL фонового изображения" value={templateForm.background_image_url} onChange={(e) => setTemplateForm({ ...templateForm, background_image_url: e.target.value })} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">Описание<textarea className="min-h-20 rounded-2xl border border-slate-200 px-4 py-3" value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 md:col-span-2">Условия<textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" value={templateForm.terms} onChange={(e) => setTemplateForm({ ...templateForm, terms: e.target.value })} /></label>
          <label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" checked={templateForm.is_active} onChange={(e) => setTemplateForm({ ...templateForm, is_active: e.target.checked })} />Активен</label>
        </div>
      </Modal>

      <Modal
        title="Оформить сертификат"
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setWizardOpen(false)}>Отмена</Button>{wizardStep > 1 && <Button variant="secondary" onClick={() => setWizardStep(wizardStep - 1)}>Назад</Button>}{wizardStep < 3 ? <Button onClick={() => setWizardStep(wizardStep + 1)}>Далее</Button> : <Button onClick={createCertificate}>Создать сертификат</Button>}</>}
      >
        <div className="mb-5 grid grid-cols-3 gap-2 text-center text-sm font-bold">
          {['Шаблон', 'Оформление', 'Подтверждение'].map((label, idx) => <div key={label} className={`rounded-xl px-3 py-2 ${wizardStep === idx + 1 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500'}`}>{label}</div>)}
        </div>
        {wizardStep === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            {templates.filter((item) => item.is_active).map((template) => (
              <button key={template.id} type="button" onClick={() => setCertificateForm({ ...certificateForm, template: String(template.id), face_value: template.amount_type === 'fixed' ? template.fixed_amount : template.min_amount })} className={`rounded-[24px] border p-3 text-left ${String(certificateForm.template) === String(template.id) ? 'border-brand ring-4 ring-brand/10' : 'border-slate-100'}`}>
                <CertificateCard template={template} compact />
                <p className="mt-3 font-black">{template.name}</p>
              </button>
            ))}
          </div>
        )}
        {wizardStep === 2 && (
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Шаблон" value={certificateForm.template} onChange={(value) => setCertificateForm({ ...certificateForm, template: value })} options={[{ value: '', label: 'Выберите шаблон' }, ...templateOptions]} />
            <SelectField label="Клиент-покупатель" value={certificateForm.purchaser_client} onChange={(value) => setCertificateForm({ ...certificateForm, purchaser_client: value })} options={[{ value: '', label: 'Без клиента' }, ...clientOptions]} />
            <Input label="Получатель" value={certificateForm.recipient_name} onChange={(e) => setCertificateForm({ ...certificateForm, recipient_name: e.target.value })} />
            <Input label="Телефон получателя" value={certificateForm.recipient_phone} onChange={(e) => setCertificateForm({ ...certificateForm, recipient_phone: e.target.value })} />
            <Input label="Номинал" type="number" value={certificateForm.face_value} onChange={(e) => setCertificateForm({ ...certificateForm, face_value: e.target.value })} disabled={selectedTemplate?.amount_type === 'fixed'} />
            <Input label="Дата оформления" type="date" value={certificateForm.issued_at} onChange={(e) => setCertificateForm({ ...certificateForm, issued_at: e.target.value })} />
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold md:col-span-2">
              <p>Номинал: {money(certificateForm.face_value)}</p>
              <p className="text-emerald-700">Скидка при покупке: {Number(selectedTemplate?.sale_discount_percent || 0).toLocaleString('ru-RU')}%</p>
              <p className="mt-1 text-base text-slate-900">Цена продажи: {money(calculatedSalePrice)}</p>
            </div>
            {calculatedSalePrice > 0 && <PaymentSplitFields totalAmount={calculatedSalePrice} value={certificateForm.payment_parts} onChange={(payment_parts) => setCertificateForm({ ...certificateForm, payment_parts })} />}
          </div>
        )}
        {wizardStep === 3 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <CertificateCard certificate={{ ...certificateForm, template_title: selectedTemplate?.title, title: selectedTemplate?.title, subtitle: selectedTemplate?.subtitle, design: selectedTemplate, valid_until: 'будет рассчитано' }} />
            <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm font-semibold text-slate-700">
              <p>Получатель: {certificateForm.recipient_name || '—'}</p>
              <p>Телефон: {certificateForm.recipient_phone || '—'}</p>
              <p>Номинал: {money(certificateForm.face_value)}</p>
              <p>Цена продажи: {money(calculatedSalePrice)}</p>
              <p>Оплачено: {money(paymentPartsTotal(certificateForm.payment_parts))}</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={selectedCertificate ? `Сертификат ${selectedCertificate.code}` : 'Сертификат'}
        open={Boolean(selectedCertificate)}
        onClose={() => setSelectedCertificate(null)}
        footer={<><Button variant="secondary" onClick={() => setSelectedCertificate(null)}>Закрыть</Button></>}
      >
        {selectedCertificate && (
          <div className="grid gap-5">
            <CertificateCard certificate={selectedCertificate} cardRef={cardRef} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={openWhatsapp}><MessageCircle size={16} />Открыть WhatsApp</Button>
              <Button variant="secondary" onClick={sharePng}><Send size={16} />Поделиться PNG</Button>
              <Button variant="secondary" onClick={() => downloadPng(selectedCertificate)}><Download size={16} />Скачать PNG</Button>
              <a className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" href={certificatePublicUrl(selectedCertificate)} target="_blank" rel="noreferrer">Публичная страница</a>
            </div>
            <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-3">
              <Input label="Доступно" value={money(selectedCertificate.remaining_amount)} onChange={() => {}} />
              <Input label="Списать" type="number" value={redeemForm.amount} onChange={(e) => setRedeemForm({ ...redeemForm, amount: e.target.value })} />
              <Input label="Останется" value={money(Number(selectedCertificate.remaining_amount || 0) - Number(redeemForm.amount || 0))} onChange={() => {}} />
              <Input label="Комментарий" className="md:col-span-2" value={redeemForm.comment} onChange={(e) => setRedeemForm({ ...redeemForm, comment: e.target.value })} />
              <div className="flex items-end"><Button onClick={redeemCertificate} disabled={!redeemForm.amount}><RotateCcw size={16} />Использовать</Button></div>
            </div>
            <div className="rounded-2xl border border-slate-100">
              <Table data={selectedCertificate.redemptions || []} columns={[
                { key: 'redeemed_at', header: 'Дата', render: (row) => row.redeemed_at ? new Date(row.redeemed_at).toLocaleString('ru-RU') : '—' },
                { key: 'amount', header: 'Сумма', render: (row) => money(row.amount) },
                { key: 'comment', header: 'Комментарий' },
                { key: 'created_by_name', header: 'Сотрудник' },
              ]} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
