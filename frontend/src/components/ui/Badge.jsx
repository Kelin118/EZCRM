const tones = {
  active: 'bg-emerald-100 text-emerald-700',
  done: 'bg-emerald-100 text-emerald-700',
  income: 'bg-emerald-100 text-emerald-700',
  attended: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  planned: 'bg-blue-100 text-blue-700',
  makeup: 'bg-blue-100 text-blue-700',
  trial: 'bg-indigo-100 text-indigo-700',
  frozen: 'bg-cyan-100 text-cyan-700',
  todo: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  expense: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-600',
};

export default function Badge({ children, value }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[value] || 'bg-slate-100 text-slate-700'}`}>
      {children || value || '—'}
    </span>
  );
}
