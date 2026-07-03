import Badge from './Badge.jsx';

export default function KanbanColumn({ children, count = 0, emptyText = 'Нет записей', id, isOver = false, onDragOver, onDrop, title }) {
  return (
    <section
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-kanban-column={id}
      className={`flex max-h-[72vh] min-h-80 w-[300px] shrink-0 flex-col rounded-[22px] border bg-white p-4 shadow-card transition ${
        isOver ? 'border-brand/40 bg-brand/5 ring-4 ring-brand/10' : 'border-slate-100'
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <Badge value={count ? 'active' : 'todo'}>{count}</Badge>
      </div>
      <div className="scrollbar-thin grid flex-1 content-start gap-3 overflow-y-auto pr-1">
        {count ? children : <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-400">{emptyText}</div>}
      </div>
    </section>
  );
}
