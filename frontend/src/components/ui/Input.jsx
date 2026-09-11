import { useId } from 'react';

export default function Input({ label, className = '', id, name, autoComplete = 'off', ...props }) {
  const generatedId = useId();
  const inputId = id || name || generatedId;

  return (
    <label htmlFor={inputId} className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label && <span className="truncate">{label}</span>}
      <input
        id={inputId}
        name={name || inputId}
        autoComplete={autoComplete}
        className={`min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 transition-[border-color,box-shadow,background-color,color] duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 ${className}`}
        {...props}
      />
    </label>
  );
}
