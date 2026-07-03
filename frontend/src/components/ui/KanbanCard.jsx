export default function KanbanCard({ children, draggable = true, dragging = false, onDragStart, onDragEnd }) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-[20px] border border-slate-100 bg-white p-4 shadow-sm transition ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'opacity-50 ring-2 ring-brand/30' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
    >
      {children}
    </article>
  );
}
