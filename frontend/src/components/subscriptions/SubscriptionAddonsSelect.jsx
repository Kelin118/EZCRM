import { useEffect, useMemo, useState } from 'react';

import api from '../../api/axios.js';
import Input from '../ui/Input.jsx';

export const addonPayload = (items = []) => (Array.isArray(items) ? items : [])
  .filter((item) => item?.catalog_item)
  .map((item) => ({ catalog_item: Number(item.catalog_item), quantity: Math.max(Number(item.quantity || 1), 1) }));

export const addonsTotal = (items = [], catalogItems = []) => (Array.isArray(items) ? items : []).reduce((sum, item) => {
  const catalogItemId = item?.catalog_item || item?.id;
  if (!catalogItemId) return sum;
  const catalogItem = catalogItems.find((addon) => String(addon.id) === String(catalogItemId));
  const price = Number(item?.unit_price ?? catalogItem?.price ?? 0);
  const quantity = Math.max(Number(item?.quantity || 1), 1);
  return sum + price * quantity;
}, 0);

const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
const categoryTitle = (category) => (category === 'product' ? 'Товары' : 'Дополнительные услуги');

export default function SubscriptionAddonsSelect({
  value = [],
  onChange,
  onCatalogItemsChange,
  categories = ['addon'],
  title = 'Дополнительные услуги',
  emptyText = 'Дополнительные услуги не добавлены. Добавьте их в Настройки → Доп. услуги.',
}) {
  const [items, setItems] = useState([]);
  const selected = addonPayload(value);
  const selectedIds = useMemo(() => new Set(selected.map((item) => String(item.catalog_item))), [selected]);
  const categoryList = useMemo(() => (Array.isArray(categories) && categories.length ? categories : ['addon']), [categories]);
  const categoryKey = categoryList.join('|');

  useEffect(() => {
    let ignore = false;
    Promise.all(categoryList.map((category) => api.get('catalog-items/', { params: { category, is_active: 'true' } })))
      .then((responses) => {
        if (ignore) return;
        const list = responses.flatMap(({ data }) => (Array.isArray(data) ? data : data.results || []));
        setItems(list);
        onCatalogItemsChange?.(list);
      })
      .catch(() => {
        if (!ignore) {
          setItems([]);
          onCatalogItemsChange?.([]);
        }
      });
    return () => {
      ignore = true;
    };
  }, [categoryKey, onCatalogItemsChange]);

  const update = (next) => onChange?.(addonPayload(next));
  const toggle = (catalogItem) => {
    if (selectedIds.has(String(catalogItem.id))) {
      update(selected.filter((item) => String(item.catalog_item) !== String(catalogItem.id)));
      return;
    }
    update([...selected, { catalog_item: catalogItem.id, quantity: 1 }]);
  };
  const changeQuantity = (catalogItem, quantity) => {
    update(selected.map((item) => (
      String(item.catalog_item) === String(catalogItem.id)
        ? { ...item, quantity: Math.max(Number(quantity || 1), 1) }
        : item
    )));
  };
  const quantityFor = (catalogItem) => selected.find((item) => String(item.catalog_item) === String(catalogItem.id))?.quantity || 1;
  const groupedItems = categoryList.map((category) => ({
    category,
    title: categoryTitle(category),
    items: items.filter((item) => item.category === category),
  }));

  return (
    <div className="grid gap-2 md:col-span-2">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {!items.length ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-4">
          {groupedItems.map((group) => (
            <div key={group.category} className="grid gap-2">
              {categoryList.length > 1 && <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.title}</p>}
              {!group.items.length ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
                  {group.title} не добавлены.
                </div>
              ) : group.items.map((item) => {
                const checked = selectedIds.has(String(item.id));
                return (
                  <div key={item.id} className={`rounded-2xl border px-4 py-3 ${checked ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white'}`}>
                    <label className="flex items-center justify-between gap-3 text-sm font-bold text-slate-800">
                      <span className="flex items-center gap-3">
                        <input type="checkbox" checked={checked} onChange={() => toggle(item)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                        {item.name}
                      </span>
                      <span className="text-slate-500">{money(item.price)}</span>
                    </label>
                    {checked && (
                      <div className="mt-3 max-w-40">
                        <Input label="Количество" type="number" min="1" value={quantityFor(item)} onChange={(event) => changeQuantity(item, event.target.value)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
