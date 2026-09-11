import { X } from 'lucide-react';
import { useEffect, useId } from 'react';

import Button from './Button.jsx';

const sizes = {
  default: 'max-w-2xl',
  wide: 'max-w-5xl',
  full: 'max-w-7xl',
};

export default function Modal({ title, open, onClose, children, footer, size = 'default' }) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-slate-950/35 p-3 backdrop-blur-sm sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Закрыть окно" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[90vh] w-full ${sizes[size] || sizes.default} flex-col overflow-hidden rounded-3xl bg-white shadow-soft`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold text-slate-900">{title}</h2>
          <Button variant="ghost" className="h-9 w-9 rounded-xl p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            <X size={20} strokeWidth={2.25} aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scrollbar-thin sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
