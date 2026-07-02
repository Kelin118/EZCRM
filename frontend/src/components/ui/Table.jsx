export default function Table({ columns, data, empty = 'Нет данных' }) {
  return (
    <div className="overflow-x-auto rounded-[22px] border border-slate-100 bg-white shadow-card scrollbar-thin">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs uppercase tracking-wide text-slate-500 backdrop-blur">
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={`whitespace-nowrap border-b border-slate-100 px-5 py-4 font-bold ${index === columns.length - 1 ? 'text-right' : ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
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
              <tr key={row.id} className="group transition hover:bg-brand/[0.03]">
                {columns.map((column, index) => (
                  <td key={column.key} className={`whitespace-nowrap border-b border-slate-100 px-5 py-4 text-slate-700 ${index === columns.length - 1 ? 'text-right' : ''}`}>
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
