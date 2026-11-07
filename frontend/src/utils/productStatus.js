export function productStatus(product) {
  const sold = Number(product.sold_quantity || 0);
  const available = product.available_quantity;
  if (available !== null && available !== undefined && Number(available) < 0) {
    return { label: 'Ошибка остатка', tone: 'overdue', group: 'inactive' };
  }
  const outOfStock = available !== null && available !== undefined && Number(available) <= 0;
  if (outOfStock && sold > 0) return { label: 'Продан', tone: 'paid', group: 'sold' };
  if (!product.is_active) return { label: 'Неактивен', tone: 'cancelled', group: 'inactive' };
  if (outOfStock) return { label: 'Нет в наличии', tone: 'today', group: 'inactive' };
  if (available === null || available === undefined) {
    return { label: 'В продаже · остаток не задан', tone: 'today', group: 'active' };
  }
  return { label: 'В продаже', tone: 'active', group: 'active' };
}

export function matchesProductFilter(product, filter) {
  if (filter === 'sold') return productStatus(product).group === 'sold';
  if (filter === 'active') return productStatus(product).group === 'active';
  if (filter === 'inactive') return productStatus(product).group === 'inactive';
  return true;
}
