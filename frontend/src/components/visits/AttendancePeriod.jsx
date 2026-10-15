import { useEffect, useState } from 'react';

import api from '../../api/axios.js';
import { formatDisplayDate } from '../../utils/dateTime.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import { Input, SelectField } from '../../pages/pageUtils.jsx';

const statusMarks = {
  attended: { symbol: '+', label: 'Посетил', className: 'bg-emerald-50 text-emerald-800' },
  makeup: { symbol: '+', label: 'Отработка', className: 'bg-emerald-50 text-emerald-800' },
  trial: { symbol: '+', label: 'Пробное', className: 'bg-emerald-50 text-emerald-800' },
  missed: { symbol: '−', label: 'Пропуск', className: 'bg-rose-50 text-rose-800' },
  sick: { symbol: 'Б', label: 'Болел', className: 'bg-amber-50 text-amber-800' },
  frozen: { symbol: 'З', label: 'Заморозка', className: 'bg-sky-50 text-sky-800' },
  cancelled: { symbol: '×', label: 'Отменено', className: 'bg-slate-100 text-slate-600' },
};

const statusOptions = [
  { value: 'planned', label: 'Не отмечено' },
  { value: 'attended', label: 'Посетил' },
  { value: 'sick', label: 'Болел' },
  { value: 'missed', label: 'Пропуск' },
  { value: 'makeup', label: 'Отработка' },
  { value: 'frozen', label: 'Заморозка' },
  { value: 'trial', label: 'Пробное' },
  { value: 'cancelled', label: 'Отменено' },
];

export default function AttendancePeriod({ groupOptions, group, onGroupChange, range, onRangeChange, onOpenLesson, canEdit }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState(null);
  const [subscriptionOptions, setSubscriptionOptions] = useState([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!group || !range.date_from || !range.date_to) {
      setReport(null);
      setError('');
      return undefined;
    }
    if (range.date_from > range.date_to) {
      setReport(null);
      setError('Дата окончания должна быть не раньше даты начала.');
      return undefined;
    }
    let ignore = false;
    setLoading(true);
    setError('');
    setReport(null);
    api.get('lessons/attendance-period/', { params: { group, ...range } })
      .then(({ data }) => { if (!ignore) setReport(data); })
      .catch((requestError) => {
        if (!ignore) setError(requestError.response?.data?.detail || requestError.response?.data?.date_to?.[0] || 'Не удалось загрузить табель.');
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [group, range.date_from, range.date_to, reload]);

  useEffect(() => {
    if (!editor) return undefined;
    let ignore = false;
    setSubscriptionsLoading(true);
    setSubscriptionOptions([]);
    api.get('subscriptions/', { params: { client: editor.student.client } })
      .then(({ data }) => {
        if (!ignore) setSubscriptionOptions(Array.isArray(data) ? data : data?.results || []);
      })
      .catch(() => { if (!ignore) setEditorError('Не удалось загрузить абонементы ученика.'); })
      .finally(() => { if (!ignore) setSubscriptionsLoading(false); });
    return () => { ignore = true; };
  }, [editor?.student.client]);

  const openEditor = (student, lesson, cell) => {
    setEditor({
      student,
      lesson,
      original: cell,
      status: cell.status || 'planned',
      comment: cell.comment || '',
      subscription: cell.subscription ? String(cell.subscription) : '',
    });
    setEditorError('');
  };

  const changed = editor && (
    editor.status !== (editor.original.status || 'planned')
    || editor.comment !== (editor.original.comment || '')
    || editor.subscription !== (editor.original.subscription ? String(editor.original.subscription) : '')
  );

  const saveCell = async () => {
    if (!editor || !changed || saving) return;
    setSaving(true);
    setEditorError('');
    try {
      await api.post(`lessons/${editor.lesson.id}/attendance/`, {
        items: [{
          client: editor.student.client,
          status: editor.status,
          comment: editor.comment,
          subscription: editor.subscription || null,
          auto_subscription: false,
        }],
      });
      setEditor(null);
      setReload((current) => current + 1);
      window.dispatchEvent(new CustomEvent('api-success', { detail: 'Посещение сохранено.' }));
    } catch (requestError) {
      const detail = requestError.response?.data?.detail || requestError.response?.data?.status?.[0];
      setEditorError(typeof detail === 'string' ? detail : 'Не удалось сохранить посещение.');
    } finally {
      setSaving(false);
    }
  };

  const lessons = report?.lessons || [];
  const students = report?.students || [];

  return (
    <section className="min-w-0">
      <div className="mb-4 grid gap-3 rounded-[22px] border border-slate-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto] lg:items-end">
        <SelectField label="Группа" value={group} onChange={onGroupChange} options={[{ value: '', label: 'Выберите группу' }, ...groupOptions]} />
        <Input label="С даты" type="date" value={range.date_from} onChange={(event) => onRangeChange((current) => ({ ...current, date_from: event.target.value }))} />
        <Input label="По дату" type="date" value={range.date_to} onChange={(event) => onRangeChange((current) => ({ ...current, date_to: event.target.value }))} />
        <Button variant="secondary" onClick={() => setReload((current) => current + 1)} disabled={!group || loading}>Обновить</Button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {!group && <p className="py-10 text-center text-sm text-slate-500">Выберите группу для просмотра табеля.</p>}
      {group && loading && <p className="py-10 text-center text-sm text-slate-500">Загрузка табеля...</p>}
      {report && !loading && (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{report.group.name}</h3>
            <p className="text-sm text-slate-500">Уроков: {lessons.length} · Учеников: {students.length}</p>
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>+ посещение</span><span>− пропуск</span><span>Б болел</span><span>З заморозка</span><span>· не отмечено</span><span>Серая клетка: вне группы</span>
          </div>
          {!lessons.length ? (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">В выбранном периоде нет созданных уроков этой группы.</p>
          ) : (
            <div className="max-h-[75vh] max-w-full overflow-auto border border-slate-200 bg-white">
              <table className="w-max min-w-full border-separate border-spacing-0 text-center text-sm">
                <thead className="sticky top-0 z-20 bg-slate-50 text-slate-700">
                  <tr>
                    <th scope="col" className="sticky left-0 z-30 min-w-48 max-w-56 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">Ученик</th>
                    {lessons.map((lesson) => (
                      <th key={lesson.id} scope="col" className="min-w-16 border-b border-r border-slate-200 px-1 py-2 font-semibold">
                        <button type="button" className="w-full hover:text-brand focus-visible:outline-2 focus-visible:outline-brand" onClick={() => onOpenLesson(lesson, group)} title="Открыть журнал урока">
                          <span className="block">{formatDisplayDate(lesson.date).slice(0, 5)}</span>
                          <span className="block text-xs font-normal text-slate-500">{lesson.start_time}</span>
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-2 py-2">Посетил</th>
                    <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-2 py-2">Болел</th>
                    <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-2 py-2">Пропуск</th>
                    <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-2 py-2">Без отметки</th>
                    <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-2 py-2">Списано</th>
                    <th scope="col" className="min-w-20 border-b border-slate-200 px-2 py-2" title="Остаток по текущему активному абонементу">Сейчас осталось</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.client} className="hover:bg-slate-50">
                      <th scope="row" className="sticky left-0 z-10 max-w-56 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-medium text-slate-900">
                        <span className="block break-words">{student.client_name}</span>
                        {!student.current_member && <span className="block text-xs font-normal text-slate-500">Был в группе</span>}
                      </th>
                      {student.cells.map((cell, index) => {
                        const mark = statusMarks[cell.status] || { symbol: '·', label: 'Не отмечено', className: 'text-slate-400' };
                        const title = `${student.client_name}, ${formatDisplayDate(lessons[index].date)} ${lessons[index].start_time}: ${mark.label}${cell.deducted ? ', занятие списано' : ''}`;
                        return (
                          <td key={lessons[index].id} className={`h-11 min-w-16 border-b border-r border-slate-200 p-0 ${cell.eligible ? mark.className : 'bg-slate-100'}`}>
                            {cell.eligible && (canEdit && cell.editable
                              ? <button type="button" className="h-11 w-full text-base font-semibold hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand" onClick={() => openEditor(student, lessons[index], cell)} title={`Изменить: ${title}`} aria-label={`Изменить: ${title}`}>{mark.symbol}</button>
                              : <span className="inline-grid h-11 w-full place-items-center text-base font-semibold" title={title}>{mark.symbol}</span>)}
                          </td>
                        );
                      })}
                      <td className="border-b border-r border-slate-200 px-2 font-semibold">{student.totals.attended}</td>
                      <td className="border-b border-r border-slate-200 px-2">{student.totals.sick}</td>
                      <td className="border-b border-r border-slate-200 px-2">{student.totals.missed}</td>
                      <td className="border-b border-r border-slate-200 px-2">{student.totals.unmarked}</td>
                      <td className="border-b border-r border-slate-200 px-2 font-semibold">{student.totals.deducted}</td>
                      <td className="border-b border-slate-200 px-2 font-semibold" title={student.subscription_title || 'Нет активного абонемента'}>{student.remaining_lessons ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!students.length && <p className="px-4 py-8 text-center text-sm text-slate-500">В группе нет учеников за выбранный период.</p>}
            </div>
          )}
        </>
      )}
      <Modal
        title="Отметка посещения"
        open={Boolean(editor)}
        onClose={() => { if (!saving) setEditor(null); }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={saving}>Отмена</Button>
            <Button onClick={saveCell} disabled={!changed || saving || subscriptionsLoading}>{saving ? 'Сохранение...' : 'Сохранить'}</Button>
          </>
        }
      >
        {editor && (
          <div className="grid gap-4">
            <p className="text-sm font-semibold text-slate-800">{editor.student.client_name} · {formatDisplayDate(editor.lesson.date)} · {editor.lesson.start_time}</p>
            {editorError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{editorError}</p>}
            <SelectField label="Отметка" value={editor.status} onChange={(status) => setEditor((current) => ({ ...current, status }))} options={statusOptions} />
            <SelectField
              label="Абонемент"
              value={editor.subscription}
              onChange={(subscription) => setEditor((current) => ({ ...current, subscription }))}
              options={[
                { value: '', label: subscriptionsLoading ? 'Загрузка...' : 'Без абонемента' },
                ...subscriptionOptions.map((subscription) => ({ value: String(subscription.id), label: `${subscription.title} · ${subscription.start_date}–${subscription.end_date || '...'} · осталось ${subscription.remaining_visits}` })),
              ]}
            />
            {editor.status === 'attended' && !editor.subscription && !subscriptionsLoading && (
              <p className="text-sm text-amber-800">Без абонемента занятие не спишется.</p>
            )}
            <Input label="Комментарий" value={editor.comment} onChange={(event) => setEditor((current) => ({ ...current, comment: event.target.value }))} />
          </div>
        )}
      </Modal>
    </section>
  );
}
