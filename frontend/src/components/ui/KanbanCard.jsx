import { GripVertical } from 'lucide-react';

export default function KanbanCard({ children, draggable = true, dragging = false, dragHandleLabel = 'Перетащить карточку', onDragStart, onDragEnd }) {
  return (
    <article
      className={`rounded-[20px] border border-slate-100 bg-white p-4 shadow-sm transition ${
        dragging ? 'opacity-50 ring-2 ring-brand/30' : 'hover:-translate-y-0.5 hover:shadow-md'
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
            className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing cursor-grab [touch-action:none]"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </article>
  );
}
