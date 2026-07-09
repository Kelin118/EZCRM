import { X } from 'lucide-react';

import Button from './Button.jsx';

const sizes = {
  default: 'max-w-2xl',
  wide: 'max-w-5xl',
  full: 'max-w-7xl',
};

export default function Modal({ title, open, onClose, children, footer, size = 'default' }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-3 backdrop-blur-sm sm:p-4">
      <div className={`flex max-h-[90vh] w-full ${sizes[size] || sizes.default} flex-col overflow-hidden rounded-[24px] bg-white shadow-soft`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <Button variant="ghost" className="h-9 w-9 rounded-xl p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            <X size={20} strokeWidth={2.25} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scrollbar-thin sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
