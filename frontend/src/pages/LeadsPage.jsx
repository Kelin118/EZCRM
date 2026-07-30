import { Inbox, MessageCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import { Badge, Filters, Input, PageHeader, SelectField, Table, dateTime, showApiError } from './pageUtils.jsx';
import { clientLabel, employeeLabel, toList, useClientOptions, useEmployeeOptions, useLookup } from './lookupUtils.jsx';

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новое' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'qualified', label: 'Квалифицирован' },
  { value: 'trial_booked', label: 'Записан на пробник' },
  { value: 'won', label: 'Продажа' },
  { value: 'lost', label: 'Не купил' },
  { value: 'spam', label: 'Спам' },
];

const sourceOptions = [
  { value: '', label: 'Все источники' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'manual', label: 'Вручную' },
];

const kanbanStatuses = statusOptions.filter((item) => item.value);

const emptyClientForm = { first_name: '', last_name: '', phone: '', parent_name: '', branch: '', manager: '', notes: '' };
const emptyTrialForm = { scheduled_at: '', teacher: '', manager: '', branch: '', price: '0.00', notes: '' };

function sourceLabel(value) {
  if (value === 'whatsapp') return 'WhatsApp';
  if (value === 'instagram') return 'Instagram';
  return 'Вручную';
}

function messengerLink(lead) {
  if (lead.source === 'whatsapp' && lead.contact_phone) return `https://wa.me/${lead.contact_phone}`;
  if (lead.source === 'instagram' && lead.contact_username) return `https://instagram.com/${lead.contact_username.replace(/^@/, '')}`;
  return '';
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [filters, setFilters] = useState({ search: '', source: '', status: '', unread: '' });
  const [view, setView] = useState('kanban');
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clientModal, setClientModal] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [trialModal, setTrialModal] = useState(false);
  const [trialForm, setTrialForm] = useState(emptyTrialForm);
  const [loading, setLoading] = useState(false);

  const { clientOptions, refreshClients } = useClientOptions();
  const { employeeOptions: managerOptions } = useEmployeeOptions(['manager']);
  const { employeeOptions: teacherOptions } = useEmployeeOptions(['teacher']);
  const { items: branches } = useLookup('branches/');
  const branchOptions = branches.map((branch) => ({ value: String(branch.id), label: branch.name }));

  const loadLeads = async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data } = await api.get('leads/', { params });
      setLeads(toList(data));
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const openLead = async (lead) => {
    setSelected(lead);
    try {
      const { data } = await api.get(`leads/${lead.id}/messages/`);
      setMessages(toList(data));
      if (lead.unread_count > 0) {
        const response = await api.post(`leads/${lead.id}/mark-read/`);
        setSelected(response.data);
        setLeads((items) => items.map((item) => (item.id === response.data.id ? response.data : item)));
      }
    } catch (error) {
      showApiError(error);
    }
  };

  useEffect(() => { loadLeads(); }, [JSON.stringify(filters)]);

  const updateLead = async (path, payload = {}) => {
    if (!selected) return null;
    try {
      const { data } = await api.post(`leads/${selected.id}/${path}/`, payload);
      setSelected(data);
      setLeads((items) => items.map((item) => (item.id === data.id ? data : item)));
      return data;
    } catch (error) {
      showApiError(error);
      return null;
    }
  };

  const createClient = async () => {
    const data = await updateLead('create-client', clientForm);
    if (data) {
      setClientModal(false);
      setClientForm(emptyClientForm);
      refreshClients?.();
    }
  };

  const linkClient = async (client) => updateLead('link-client', { client });

  const convertToTrial = async () => {
    const data = await updateLead('convert-to-trial', trialForm);
    if (data) {
      setTrialModal(false);
      setTrialForm(emptyTrialForm);
    }
  };

  const columns = useMemo(() => [
    { key: 'source', header: 'Источник', render: (row) => sourceLabel(row.source) },
    { key: 'contact_name', header: 'Контакт', render: (row) => row.contact_name || row.contact_username || row.contact_phone || '—' },
    { key: 'contact_phone', header: 'Телефон / username', render: (row) => row.contact_phone || row.contact_username || '—' },
    { key: 'last_message', header: 'Последнее сообщение' },
    { key: 'last_message_at', header: 'Время', render: (row) => dateTime(row.last_message_at) },
    { key: 'unread_count', header: 'Непрочитано' },
    { key: 'manager_name', header: 'Менеджер', render: (row) => row.manager_name || 'Не назначен' },
    { key: 'status', header: 'Статус', render: (row) => <Badge value={row.status}>{row.status_display || row.status}</Badge> },
    { key: 'actions', header: '', render: (row) => <Button variant="secondary" onClick={() => openLead(row)}>Открыть</Button> },
  ], []);

  const openClientModal = () => {
    setClientForm({
      ...emptyClientForm,
      first_name: selected?.contact_name || selected?.contact_username || '',
      phone: selected?.contact_phone || '',
      branch: selected?.branch ? String(selected.branch) : '',
      manager: selected?.manager ? String(selected.manager) : '',
      notes: `Создан из обращения ${sourceLabel(selected?.source)}`,
    });
    setClientModal(true);
  };

  const openTrialModal = () => {
    setTrialForm({
      ...emptyTrialForm,
      manager: selected?.manager ? String(selected.manager) : '',
      branch: selected?.branch ? String(selected.branch) : '',
      notes: `Запись из обращения ${sourceLabel(selected?.source)}`,
    });
    setTrialModal(true);
  };

  return (
    <>
      <PageHeader title="Обращения" actionLabel="" onAction={null}>
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
          <button type="button" onClick={() => setView('kanban')} className={`rounded-xl px-4 py-2 text-sm font-bold ${view === 'kanban' ? 'bg-brand text-white' : 'text-slate-600'}`}>Канбан</button>
          <button type="button" onClick={() => setView('table')} className={`rounded-xl px-4 py-2 text-sm font-bold ${view === 'table' ? 'bg-brand text-white' : 'text-slate-600'}`}>Таблица</button>
        </div>
      </PageHeader>

      <Filters>
        <Input label="Поиск" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        <SelectField label="Источник" value={filters.source} onChange={(value) => setFilters({ ...filters, source: value })} options={sourceOptions} />
        <SelectField label="Статус" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={statusOptions} />
        <SelectField label="Непрочитанные" value={filters.unread} onChange={(value) => setFilters({ ...filters, unread: value })} options={[{ value: '', label: 'Все' }, { value: '1', label: 'Только непрочитанные' }]} />
      </Filters>

      {loading ? (
        <div className="rounded-2xl bg-white p-8 text-center font-semibold text-slate-500">Загрузка...</div>
      ) : view === 'table' ? (
        <Table data={leads} columns={columns} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-4 2xl:grid-cols-7">
          {kanbanStatuses.map((statusItem) => (
            <section key={statusItem.value} className="rounded-[24px] border border-slate-100 bg-white p-3 shadow-card">
              <h3 className="mb-3 text-sm font-black text-slate-800">{statusItem.label}</h3>
              <div className="grid gap-3">
                {leads.filter((lead) => lead.status === statusItem.value).map((lead) => (
                  <button key={lead.id} type="button" onClick={() => openLead(lead)} className={`rounded-2xl border p-3 text-left ${lead.unread_count ? 'border-brand bg-brand/5' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase text-brand">{sourceLabel(lead.source)}</span>
                      {lead.unread_count > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{lead.unread_count}</span>}
                    </div>
                    <p className="mt-2 font-black text-slate-900">{lead.contact_name || lead.contact_username || lead.contact_phone || lead.title}</p>
                    <p className="text-xs text-slate-500">{lead.contact_phone || lead.contact_username || '—'}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{lead.last_message || 'Без текста'}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-400">{dateTime(lead.last_message_at)}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal title={selected ? selected.title : 'Обращение'} open={Boolean(selected)} onClose={() => setSelected(null)} footer={<Button variant="secondary" onClick={() => setSelected(null)}>Закрыть</Button>}>
        {selected && (
          <div className="grid gap-5">
            <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm md:grid-cols-2">
              <p><b>Источник:</b> {sourceLabel(selected.source)}</p>
              <p><b>Статус:</b> {selected.status_display || selected.status}</p>
              <p><b>Контакт:</b> {selected.contact_name || selected.contact_username || '—'}</p>
              <p><b>Телефон:</b> {selected.contact_phone || '—'}</p>
              <p><b>Менеджер:</b> {selected.manager_name || 'Не назначен'}</p>
              <p><b>Клиент:</b> {selected.client_name || 'Не связан'}</p>
              <p><b>Первое сообщение:</b> {dateTime(selected.first_message_at)}</p>
              <p><b>Последнее сообщение:</b> {dateTime(selected.last_message_at)}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => updateLead('mark-read')}>Отметить прочитанным</Button>
              <Button variant="secondary" onClick={() => updateLead('assign')}>Назначить мне</Button>
              <Button variant="secondary" onClick={openClientModal} disabled={Boolean(selected.client)}>Создать клиента</Button>
              <Button variant="secondary" onClick={openTrialModal} disabled={!selected.client}>Создать пробник</Button>
              <Button variant="secondary" onClick={() => updateLead('close', { status: 'lost' })}>Закрыть</Button>
              <Button variant="secondary" onClick={() => updateLead('close', { status: 'spam' })}>В спам</Button>
              {messengerLink(selected) ? <a className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" href={messengerLink(selected)} target="_blank" rel="noreferrer">Открыть мессенджер</a> : <span className="text-sm font-semibold text-slate-500">Откройте диалог в Instagram Inbox</span>}
            </div>

            <div className="grid gap-2">
              <SelectField label="Связать с существующим клиентом" value={selected.client ? String(selected.client) : ''} onChange={(value) => value && linkClient(value)} options={[{ value: '', label: 'Выберите клиента' }, ...clientOptions]} />
            </div>

            <section className="rounded-2xl border border-slate-100 p-4">
              <h3 className="mb-3 font-black text-slate-900">История сообщений</h3>
              <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-2">
                {messages.map((message) => (
                  <div key={message.id} className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${message.direction === 'inbound' ? 'justify-self-start bg-slate-100' : 'justify-self-end bg-brand text-white'}`}>
                    <p className="font-semibold">{message.text || message.message_type_display || message.message_type}</p>
                    {message.file_name && <p className="mt-1 text-xs opacity-70">{message.file_name}</p>}
                    <p className="mt-2 text-[11px] opacity-60">{dateTime(message.sent_at)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </Modal>

      <Modal title="Создать клиента" open={clientModal} onClose={() => setClientModal(false)} footer={<><Button variant="secondary" onClick={() => setClientModal(false)}>Отмена</Button><Button onClick={createClient}>Создать</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Имя" value={clientForm.first_name} onChange={(e) => setClientForm({ ...clientForm, first_name: e.target.value })} />
          <Input label="Фамилия" value={clientForm.last_name} onChange={(e) => setClientForm({ ...clientForm, last_name: e.target.value })} />
          <Input label="Телефон" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} />
          <Input label="Родитель" value={clientForm.parent_name} onChange={(e) => setClientForm({ ...clientForm, parent_name: e.target.value })} />
          <SelectField label="Филиал" value={clientForm.branch} onChange={(value) => setClientForm({ ...clientForm, branch: value })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
          <SelectField label="Менеджер" value={clientForm.manager} onChange={(value) => setClientForm({ ...clientForm, manager: value })} options={[{ value: '', label: 'Не назначен' }, ...managerOptions]} />
          <Input label="Комментарий" className="md:col-span-2" value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} />
        </div>
      </Modal>

      <Modal title="Создать пробник" open={trialModal} onClose={() => setTrialModal(false)} footer={<><Button variant="secondary" onClick={() => setTrialModal(false)}>Отмена</Button><Button onClick={convertToTrial}>Создать</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Дата и время" type="datetime-local" value={trialForm.scheduled_at} onChange={(e) => setTrialForm({ ...trialForm, scheduled_at: e.target.value })} />
          <SelectField label="Учитель" value={trialForm.teacher} onChange={(value) => setTrialForm({ ...trialForm, teacher: value })} options={[{ value: '', label: 'Не назначен' }, ...teacherOptions]} />
          <SelectField label="Менеджер" value={trialForm.manager} onChange={(value) => setTrialForm({ ...trialForm, manager: value })} options={[{ value: '', label: 'Не назначен' }, ...managerOptions]} />
          <SelectField label="Филиал" value={trialForm.branch} onChange={(value) => setTrialForm({ ...trialForm, branch: value })} options={[{ value: '', label: 'Без филиала' }, ...branchOptions]} />
          <Input label="Цена" type="number" value={trialForm.price} onChange={(e) => setTrialForm({ ...trialForm, price: e.target.value })} />
          <Input label="Комментарий" value={trialForm.notes} onChange={(e) => setTrialForm({ ...trialForm, notes: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
