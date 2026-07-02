export default function Input({ label, className = '', ...props }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label && <span>{label}</span>}
      <input
        className={`min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 ${className}`}
        {...props}
      />
    </label>
  );
}
