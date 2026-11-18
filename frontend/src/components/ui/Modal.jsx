import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import Button from './Button.jsx';

const sizes = {
  default: 'max-w-2xl',
  wide: 'max-w-5xl',
  full: 'max-w-7xl',
};

export default function Modal({ title, open, onClose, children, footer, size = 'default' }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    return () => {
      if (dialogRef.current?.open) dialogRef.current.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose?.(); }}
      onClick={(event) => {
        if (event.target !== dialogRef.current) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose?.();
      }}
      className={`m-auto max-h-[90vh] w-[calc(100%-1.5rem)] ${sizes[size] || sizes.default} overflow-hidden overscroll-contain rounded-3xl border-0 bg-white p-0 shadow-soft backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm`}
    >
      <div
        className="flex max-h-[90vh] flex-col"
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
    </dialog>
  );
}
