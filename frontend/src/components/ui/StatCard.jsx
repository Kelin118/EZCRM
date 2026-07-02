export default function StatCard({ title, value, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand/10 text-brand',
    accent: 'bg-accent/70 text-slate-900',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="rounded-[22px] border border-slate-100 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value ?? 0}</p>
        </div>
        {Icon && (
          <div className={`grid h-12 w-12 place-items-center rounded-2xl ${tones[tone]}`}>
            <Icon size={20} />
          </div>
        )}
      </div>
    </div>
  );
}
