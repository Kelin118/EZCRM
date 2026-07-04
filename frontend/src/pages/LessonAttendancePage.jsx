import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import api from '../api/axios.js';
import { Button, Input, PageHeader, SelectField, Table, dateOnly, showApiError } from './pageUtils.jsx';

const visitStatusOptions = [
  { value: 'attended', label: 'Пришел' },
  { value: 'missed', label: 'Не пришел' },
  { value: 'makeup', label: 'Отработка' },
  { value: 'frozen', label: 'Заморозка' },
  { value: 'trial', label: 'Пробное' },
];

export default function LessonAttendancePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [students, setStudents] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await api.get(`lessons/${id}/attendance/`);
    setLesson(data.lesson);
    setStudents(
      data.students.map((student) => ({
        ...student,
        subscription: student.visit?.subscription || student.subscription || '',
        status: student.status || 'attended',
        comment: student.comment || '',
      })),
    );
  };

  useEffect(() => {
    load().catch(showApiError);
  }, [id]);

  const setStudent = (clientId, patch) => {
    setStudents((current) => current.map((student) => (student.client === clientId ? { ...student, ...patch } : student)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const items = students.map((student) => ({
        client: student.client,
        subscription: student.subscription || null,
        status: student.status,
        comment: student.comment,
      }));
      const { data } = await api.post(`lessons/${id}/attendance/`, { items });
      setLesson(data.lesson);
      setStudents(
        data.students.map((student) => ({
          ...student,
          subscription: student.visit?.subscription || student.subscription || '',
          status: student.status || 'attended',
          comment: student.comment || '',
        })),
      );
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Отметка посещений">
        <Link to="/schedule">
          <Button variant="secondary"><ArrowLeft size={16} />Назад</Button>
        </Link>
      </PageHeader>

      {lesson && (
        <div className="mb-5 grid gap-4 rounded-[22px] border border-slate-100 bg-white p-5 shadow-card md:grid-cols-5">
          <div>
            <p className="text-xs font-bold uppercase text-slate-400">Группа</p>
            <p className="mt-1 font-semibold text-slate-900">{lesson.group_name || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-400">Дата</p>
            <p className="mt-1 font-semibold text-slate-900">{dateOnly(lesson.lesson_date)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-400">Время</p>
            <p className="mt-1 font-semibold text-slate-900">{lesson.start_time?.slice(0, 5)} - {lesson.end_time?.slice(0, 5)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-400">Учитель</p>
            <p className="mt-1 font-semibold text-slate-900">{lesson.teacher_name || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-400">Предмет</p>
            <p className="mt-1 font-semibold text-slate-900">{lesson.subject_name || '-'}</p>
          </div>
        </div>
      )}

      <Table
        data={students}
        empty="В группе нет учеников"
        columns={[
          { key: 'client_name', header: 'Ученик' },
          { key: 'client_phone', header: 'Телефон' },
          {
            key: 'subscription',
            header: 'Абонемент',
            render: (row) => (
              <SelectField
                label=""
                value={row.subscription || ''}
                onChange={(value) => setStudent(row.client, { subscription: value })}
                options={[
                  { value: '', label: 'Без абонемента' },
                  ...(row.subscription ? [{ value: String(row.subscription), label: row.subscription_title || `Абонемент #${row.subscription}` }] : []),
                ]}
              />
            ),
          },
          { key: 'lessons_left', header: 'Остаток', render: (row) => row.lessons_left ?? '-' },
          {
            key: 'status',
            header: 'Статус',
            render: (row) => <SelectField label="" value={row.status} onChange={(value) => setStudent(row.client, { status: value })} options={visitStatusOptions} />,
          },
          {
            key: 'comment',
            header: 'Комментарий',
            render: (row) => <Input label="" value={row.comment} onChange={(event) => setStudent(row.client, { comment: event.target.value })} />,
          },
        ]}
      />

      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={() => navigate('/schedule')}>Отмена</Button>
        <Button onClick={save} disabled={saving}><Save size={16} />Сохранить посещения</Button>
      </div>
    </>
  );
}
