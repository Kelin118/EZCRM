function cellAlign(column, index, total) {
  if (column.align === 'right' || index === total - 1) return 'text-right';
  if (column.align === 'center') return 'text-center';
  return 'text-left';
}

export default function Table({ columns, data = [], empty = 'Нет данных', loading = false }) {
  return (
    <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-card scrollbar-thin">
      <table className="min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs text-slate-500 backdrop-blur">
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={`whitespace-nowrap border-b border-slate-100 px-4 py-3 font-semibold ${cellAlign(column, index, columns.length)}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className="px-5 py-10 text-center" colSpan={columns.length}>
                <div className="mx-auto inline-flex items-center rounded-full border border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-500">
                  Загрузка…
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td className="px-5 py-12 text-center" colSpan={columns.length}>
                <div className="mx-auto max-w-sm rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-slate-500">
                  <p className="font-semibold text-slate-700">{empty}</p>
                  <p className="mt-1 text-xs text-slate-400">Данные появятся здесь после добавления записей.</p>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr key={row.id} className="group transition-colors duration-150 hover:bg-brand/[0.025]">
                {columns.map((column, index) => (
                  <td key={column.key} className={`max-w-sm border-b border-slate-100 px-4 py-3 align-middle text-slate-700 ${cellAlign(column, index, columns.length)} ${column.nowrap === false ? '' : 'whitespace-nowrap'}`}>
                    {column.render ? column.render(row) : row[column.key] || '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
