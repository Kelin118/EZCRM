import { useState } from 'react';

import KanbanColumn from './KanbanColumn.jsx';

export default function KanbanBoard({ columns, getColumnId, getItemId = (item) => item.id, items, onMove, renderCard }) {
  const [dragged, setDragged] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  const handleDrop = async (columnId) => {
    const item = dragged;
    setDragged(null);
    setOverColumn(null);
    if (!item) return;
    const fromColumnId = getColumnId(item);
    if (fromColumnId === columnId) return;
    await onMove(item, columnId, fromColumnId);
  };

  return (
    <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-3">
      <div className="flex min-w-max gap-4">
        {columns.map((column) => {
          const columnItems = items.filter((item) => getColumnId(item) === column.id);
          return (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              count={columnItems.length}
              isOver={overColumn === column.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (overColumn !== column.id) setOverColumn(column.id);
              }}
              onDrop={() => handleDrop(column.id)}
            >
              {columnItems.map((item) => renderCard(item, {
                dragging: dragged && getItemId(dragged) === getItemId(item),
                onDragEnd: () => {
                  setDragged(null);
                  setOverColumn(null);
                },
                onDragStart: (event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDragged(item);
                },
              }))}
            </KanbanColumn>
          );
        })}
      </div>
    </div>
  );
}
