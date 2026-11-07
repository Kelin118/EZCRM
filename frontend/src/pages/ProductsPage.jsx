import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Pencil, ShoppingBag } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import api from '../api/axios.js';
import { getStoredUser, hasRole, isAdmin, ROLES } from '../auth.js';
import AddonSaleModal from '../components/sales/AddonSaleModal.jsx';
import AuthenticatedImage from '../components/ui/AuthenticatedImage.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Modal from '../components/ui/Modal.jsx';
import { matchesProductFilter, productStatus } from '../utils/productStatus.js';
import { PageHeader } from './pageUtils.jsx';

const money = (value) => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₸`;
const emptyForm = { name: '', price: '', owner_name: '', total_stock_quantity: '1', is_active: true };
const filters = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'В продаже' },
  { value: 'sold', label: 'Проданные' },
  { value: 'inactive', label: 'Не продаются' },
];

function errorMessage(error) {
  const data = error.response?.data;
  if (typeof data === 'string') return data;
  if (data?.detail) return data.detail;
  const first = data && Object.values(data)[0];
  if (Array.isArray(first)) return first[0];
  return typeof first === 'string' ? first : 'Не удалось сохранить товар. Повторите попытку.';
}

export default function ProductsPage() {
  const user = getStoredUser();
  const canEdit = isAdmin(user);
  const canSell = hasRole(user, [ROLES.ADMIN, ROLES.MANAGER]);
  const [params, setParams] = useSearchParams();
  const filter = filters.some((option) => option.value === params.get('status')) ? params.get('status') : 'all';
  const search = params.get('search') || '';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [modalItem, setModalItem] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
  const [saleItemId, setSaleItemId] = useState(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('catalog-items/', { params: { category: 'product' } });
      setProducts(Array.isArray(data) ? data : data.results || []);
      setPageError('');
    } catch (error) {
      setPageError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const visibleProducts = useMemo(() => products.filter((product) => (
    matchesProductFilter(product, filter)
    && `${product.name} ${product.owner_name || ''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'))
  )), [products, filter, search]);

  const updateParams = (key, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const openEditor = (product = null) => {
    setModalItem(product);
    setForm(product ? {
      name: product.name,
      price: product.price,
      owner_name: product.owner_name || '',
      total_stock_quantity: product.total_stock_quantity ?? '',
      is_active: product.is_active,
    } : { ...emptyForm });
    setFormError('');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (!saving && !imageSaving) setEditorOpen(false);
  };

  const refreshItem = async (id) => {
    const { data } = await api.get(`catalog-items/${id}/`);
    setModalItem(data);
    await loadProducts();
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim() || form.price === '' || Number(form.price) < 0) {
      setFormError('Укажите название и неотрицательную цену.');
      return;
    }
    const quantity = form.total_stock_quantity;
    if (quantity !== '' && (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 0)) {
      setFormError('Укажите целое неотрицательное количество.');
      return;
    }
    if (!modalItem && quantity === '') {
      setFormError('Укажите количество товара, чтобы видеть, когда он продан.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(), price: form.price, owner_name: form.owner_name.trim(),
        total_stock_quantity: quantity === '' ? null : Number(quantity),
        category: 'product', is_active: form.is_active,
      };
      const { data } = modalItem
        ? await api.patch(`catalog-items/${modalItem.id}/`, payload)
        : await api.post('catalog-items/', payload);
      setModalItem(data);
      await loadProducts();
      if (modalItem) setEditorOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !modalItem) return;
    const body = new FormData();
    body.append('file', file);
    setImageSaving(true);
    setFormError('');
    try {
      await api.post(`catalog-items/${modalItem.id}/images/`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refreshItem(modalItem.id);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setImageSaving(false);
    }
  };

  const changeImage = async (image, action) => {
    setImageSaving(true);
    setFormError('');
    try {
      if (action === 'delete') await api.delete(`catalog-items/${modalItem.id}/images/${image.id}/`);
      else await api.patch(`catalog-items/${modalItem.id}/images/${image.id}/`, { is_primary: true });
      await refreshItem(modalItem.id);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setImageSaving(false);
    }
  };

  const toggleActive = async (product) => {
    try {
      await api.patch(`catalog-items/${product.id}/`, { is_active: !product.is_active });
      await loadProducts();
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader title="Товары" description="Видно, какие товары доступны и сколько уже продано. Продажа оформляется вместе с оплатой."
        actionLabel="Добавить товар" onAction={canEdit ? () => openEditor() : undefined}>
        <Badge value="active">В продаже: {products.filter((item) => matchesProductFilter(item, 'active')).length}</Badge>
        <Badge value="paid">Продано штук: {products.reduce((sum, item) => sum + Number(item.sold_quantity || 0), 0)}</Badge>
      </PageHeader>

      <div className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-card sm:p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Статус товара">
            {filters.map((option) => (
              <Button key={option.value} variant={filter === option.value ? 'primary' : 'secondary'}
                onClick={() => updateParams('status', option.value)} aria-pressed={filter === option.value}>
                {option.label}
              </Button>
            ))}
          </div>
          <Input label="Поиск по названию или владельцу" value={search}
            onChange={(event) => updateParams('search', event.target.value)} className="min-w-0 lg:w-72" />
        </div>
        {pageError && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</p>}
        {loading ? <p className="py-10 text-center text-sm text-slate-500">Загрузка товаров…</p>
          : visibleProducts.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Товары по выбранному фильтру не найдены.</p>
            : <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>{['Товар', 'Цена', 'Всего', 'Продано', 'Осталось', 'Статус', 'Действия'].map((label) => <th key={label} scope="col" className="border-b border-slate-100 px-4 py-3 font-bold">{label}</th>)}</tr>
                </thead>
                <tbody>{visibleProducts.map((product) => {
                  const status = productStatus(product);
                  const sellable = status.group === 'active';
                  return <tr key={product.id} className="border-b border-slate-100 last:border-0">
                    <td className="min-w-56 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {product.primary_image_url ? <AuthenticatedImage src={product.primary_image_url} alt={product.name}
                          className="h-12 w-12 shrink-0 rounded-xl object-cover" previewable hoverPreview previewTitle={product.name} />
                          : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><Package size={20} aria-hidden="true" /></span>}
                        <span className="min-w-0"><span className="block break-words font-semibold text-slate-900">{product.name}</span>
                          {product.owner_name && <span className="block text-xs text-slate-500">{product.owner_name}</span>}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(product.price)}</td>
                    <td className="px-4 py-3 tabular-nums">{product.total_stock_quantity ?? 'Не задано'}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{product.sold_quantity ?? 0}</td>
                    <td className="px-4 py-3 tabular-nums">{product.available_quantity ?? 'Не задано'}</td>
                    <td className="px-4 py-3"><Badge value={status.tone}>{status.label}</Badge></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
                      {canSell && sellable && <Button onClick={() => setSaleItemId(product.id)}><ShoppingBag size={16} aria-hidden="true" />Продать</Button>}
                      {canEdit && <Button variant="secondary" onClick={() => openEditor(product)}><Pencil size={16} aria-hidden="true" />Изменить</Button>}
                      {canEdit && <Button variant="ghost" onClick={() => toggleActive(product)}>{product.is_active ? 'Снять с продажи' : 'Активировать'}</Button>}
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
      </div>

      <Modal title={modalItem ? `Товар: ${modalItem.name}` : 'Новый товар'} open={editorOpen} onClose={closeEditor}
        footer={<><Button variant="secondary" onClick={closeEditor} disabled={saving || imageSaving}>Закрыть</Button>
          <Button type="submit" form="product-form" disabled={saving || imageSaving}>{saving ? 'Сохраняем…' : modalItem ? 'Сохранить' : 'Создать'}</Button></>}>
        {formError && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}
        <form id="product-form" onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
          <Input label="Название *" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input label="Цена, ₸ *" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
          <Input label="Чей товар" value={form.owner_name} onChange={(event) => setForm({ ...form, owner_name: event.target.value })} />
          <Input label="Всего товара, шт. *" type="number" min="0" step="1" required={!modalItem} value={form.total_stock_quantity} onChange={(event) => setForm({ ...form, total_stock_quantity: event.target.value })} />
          {modalItem?.total_stock_quantity == null && <p className="text-sm text-amber-700 sm:col-span-2">Для старого товара количество не задано. Укажите его, чтобы видеть, когда товар полностью продан.</p>}
          {modalItem && productStatus(modalItem).group === 'sold' && <p className="text-sm text-emerald-700 sm:col-span-2">Все экземпляры проданы. Для новой продажи увеличьте общее количество товара.</p>}
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand focus-visible:ring-brand" />Активен в каталоге
          </label>
        </form>
        {modalItem && <div className="mt-6 border-t border-slate-100 pt-5">
          <Input label="Добавить фото" type="file" accept="image/jpeg,image/png,image/webp" disabled={imageSaving} onChange={uploadImage} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{(modalItem.images || []).map((image) => <div key={image.id} className="rounded-xl border border-slate-100 p-3">
            <AuthenticatedImage src={image.thumbnail_url || image.url} alt={image.file_name || modalItem.name}
              className="h-32 w-full rounded-lg object-cover" previewable hoverPreview previewTitle={modalItem.name} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={imageSaving || image.is_primary} onClick={() => changeImage(image, 'primary')}>{image.is_primary ? 'Основное фото' : 'Сделать основным'}</Button>
              <Button variant="danger" disabled={imageSaving} onClick={() => {
                if (window.confirm('Удалить фото товара?')) changeImage(image, 'delete');
              }}>Удалить фото</Button>
            </div>
          </div>)}</div>
        </div>}
      </Modal>

      <AddonSaleModal open={saleItemId !== null} initialCatalogItemId={saleItemId}
        onClose={() => setSaleItemId(null)} onSaved={loadProducts} />
    </>
  );
}
