import { useCallback, useEffect, useRef, useState } from 'react';

function cellAlign(column, index, total) {
  if (column.align === 'right' || index === total - 1) return 'text-right';
  if (column.align === 'center') return 'text-center';
  return 'text-left';
}

export function hasHorizontalOverflow(scrollWidth, clientWidth, tolerance = 1) {
  return Number(scrollWidth || 0) > Number(clientWidth || 0) + tolerance;
}

export function shouldShowFloatingScrollbar({ overflow, tableTop, tableBottom, viewportHeight }) {
  return Boolean(
    overflow
    && Number(tableTop) < Number(viewportHeight)
    && Number(tableBottom) > Number(viewportHeight)
    && Number(tableBottom) > 0
  );
}

export default function Table({ columns, data = [], empty = 'Нет данных', loading = false, rowClassName }) {
  const realScrollRef = useRef(null);
  const stickyScrollRef = useRef(null);
  const isSyncingRef = useRef(false);
  const rafRef = useRef(null);
  const [scrollState, setScrollState] = useState({
    hasOverflow: false,
    floatingVisible: false,
    scrollWidth: 0,
    left: 0,
    width: 0,
  });

  const syncScrollLeft = useCallback((source, target) => {
    if (!source || !target || isSyncingRef.current) return;
    if (target.scrollLeft === source.scrollLeft) return;
    isSyncingRef.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }, []);

  const updateScrollState = useCallback(() => {
    const realScroll = realScrollRef.current;
    if (!realScroll) return;
    const rect = realScroll.getBoundingClientRect();
    const overflow = hasHorizontalOverflow(realScroll.scrollWidth, realScroll.clientWidth);
    const floatingVisible = shouldShowFloatingScrollbar({
      overflow,
      tableTop: rect.top,
      tableBottom: rect.bottom,
      viewportHeight: window.innerHeight,
    });
    setScrollState((current) => {
      const next = {
        hasOverflow: overflow,
        floatingVisible,
        scrollWidth: realScroll.scrollWidth,
        left: rect.left,
        width: rect.width,
      };
      if (
        current.hasOverflow === next.hasOverflow
        && current.floatingVisible === next.floatingVisible
        && current.scrollWidth === next.scrollWidth
        && current.left === next.left
        && current.width === next.width
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const scheduleScrollStateUpdate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateScrollState();
    });
  }, [updateScrollState]);

  useEffect(() => {
    const realScroll = realScrollRef.current;
    if (!realScroll) return undefined;

    updateScrollState();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleScrollStateUpdate) : null;
    resizeObserver?.observe(realScroll);
    if (realScroll.firstElementChild) {
      resizeObserver?.observe(realScroll.firstElementChild);
    }

    window.addEventListener('resize', scheduleScrollStateUpdate, { passive: true });
    document.addEventListener('scroll', scheduleScrollStateUpdate, { passive: true, capture: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleScrollStateUpdate);
      document.removeEventListener('scroll', scheduleScrollStateUpdate, { capture: true });
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [columns, data, loading, scheduleScrollStateUpdate, updateScrollState]);

  useEffect(() => {
    const realScroll = realScrollRef.current;
    const floatingScroll = stickyScrollRef.current;
    if (!realScroll || !floatingScroll || !scrollState.floatingVisible) return;
    floatingScroll.scrollLeft = realScroll.scrollLeft;
  }, [scrollState.floatingVisible]);

  return (
    <div className="relative min-w-0 w-full max-w-full">
      <div
        ref={realScrollRef}
        className="min-w-0 w-full max-w-full overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-card scrollbar-thin"
        onScroll={(event) => syncScrollLeft(event.currentTarget, stickyScrollRef.current)}
      >
        <table className="min-w-[760px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs text-slate-500 backdrop-blur">
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} className={`whitespace-nowrap border-b border-slate-100 px-4 py-3 font-semibold ${cellAlign(column, index, columns.length)} ${column.headerClassName || ''}`}>
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
                <tr key={row.id} className={`group transition-colors duration-150 hover:bg-brand/[0.025] ${rowClassName?.(row) || ''}`}>
                  {columns.map((column, index) => (
                    <td key={column.key} className={`max-w-sm border-b border-slate-100 px-4 py-3 align-middle text-slate-700 ${cellAlign(column, index, columns.length)} ${column.nowrap === false ? '' : 'whitespace-nowrap'} ${column.cellClassName || ''}`}>
                      {column.render ? column.render(row) : row[column.key] || '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {scrollState.hasOverflow && scrollState.floatingVisible && (
        <div
          ref={stickyScrollRef}
          aria-hidden="true"
          tabIndex={-1}
          className="fixed z-30 h-4 overflow-x-auto overflow-y-hidden border-t border-slate-200 bg-white/95 backdrop-blur scrollbar-thin"
          style={{
            left: scrollState.left,
            width: scrollState.width,
            bottom: 0,
          }}
          onScroll={(event) => syncScrollLeft(event.currentTarget, realScrollRef.current)}
        >
          <div style={{ width: scrollState.scrollWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
