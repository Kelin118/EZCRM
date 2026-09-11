import { GripVertical } from 'lucide-react';

export default function KanbanCard({ children, draggable = true, dragging = false, dragHandleLabel = 'Перетащить карточку', onDragStart, onDragEnd }) {
  return (
    <article
      className={`rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm transition-[border-color,box-shadow,opacity] duration-150 ${
        dragging ? 'select-none opacity-60 ring-2 ring-brand/30' : 'hover:border-brand/20 hover:shadow-card'
      }`}
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <button
            type="button"
            draggable
            aria-label={dragHandleLabel}
            data-no-drag
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="-ml-1 grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded-xl text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing [touch-action:none]"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </article>
  );
}
