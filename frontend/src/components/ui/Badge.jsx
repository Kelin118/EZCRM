const tones = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  income: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  attended: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  bought: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  today: 'border-amber-200 bg-amber-50 text-amber-700',
  planned: 'border-blue-200 bg-blue-50 text-blue-700',
  booked: 'border-blue-200 bg-blue-50 text-blue-700',
  makeup: 'border-blue-200 bg-blue-50 text-blue-700',
  trial: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  lead: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  frozen: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  todo: 'border-slate-200 bg-slate-50 text-slate-700',
  new: 'border-slate-200 bg-slate-50 text-slate-700',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700',
  expense: 'border-red-200 bg-red-50 text-red-700',
  expired: 'border-red-200 bg-red-50 text-red-700',
  overdue: 'border-red-200 bg-red-50 text-red-700',
  lost: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
};

export default function Badge({ children, value }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tones[value] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {children || value || '—'}
    </span>
  );
}
