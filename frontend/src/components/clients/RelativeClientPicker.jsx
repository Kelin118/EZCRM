import { X } from 'lucide-react';

import { useClientOptions } from '../../pages/lookupUtils.jsx';
import { SelectField } from '../../pages/pageUtils.jsx';

export default function RelativeClientPicker({ value = [], onChange, excludeId, className = '' }) {
  const { clientOptions } = useClientOptions();
  const selected = (Array.isArray(value) ? value : []).map(String);
  const options = clientOptions.filter((item) => String(item.value) !== String(excludeId || '') && !selected.includes(String(item.value)));
  const labels = new Map(clientOptions.map((item) => [String(item.value), item.label]));

  return (
    <div className={className}>
      <SelectField
        label="Родственники"
        value=""
        onChange={(id) => id && onChange([...selected, id])}
        options={[{ value: '', label: 'Выберите существующего клиента' }, ...options]}
      />
      {selected.length > 0 && (
        <div className="mt-2 grid gap-1">
          {selected.map((id) => (
            <div key={id} className="flex min-w-0 items-center justify-between gap-2 text-sm text-slate-700">
              <span className="truncate">{labels.get(id) || `Клиент #${id}`}</span>
              <button type="button" onClick={() => onChange(selected.filter((item) => item !== id))} title="Убрать родственника" aria-label={`Убрать родственника ${labels.get(id) || id}`} className="shrink-0 rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
