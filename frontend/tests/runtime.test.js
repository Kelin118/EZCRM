import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import {
  addCalendarDays, businessMonthRange, formatDateTimeLocal, formatDisplayDateTime, formatFinanceDate, normalizeDateForInput, serializeDateTimeLocal, todayLocalDate,
} from '../src/utils/dateTime.js';

const require = createRequire(import.meta.url);

async function loadModule(path) {
  const result = await build({
    entryPoints: [new URL(`../src/${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false,
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const loadApi = async () => (await loadModule('api/axios.js')).default;

test('business datetime round trip is independent of workstation timezone', () => {
  for (const zone of ['UTC', 'Asia/Almaty', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    assert.equal(formatDateTimeLocal('2026-09-14T11:00:00Z'), '2026-09-14T16:00');
    assert.equal(serializeDateTimeLocal('2026-09-14T16:00'), '2026-09-14T11:00:00.000Z');
    assert.equal(normalizeDateForInput('2026-09-14'), '2026-09-14');
  }
});

test('business day rolls over before UTC midnight', (t) => {
  process.env.TZ = 'UTC';
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-13T20:30:00Z') });
  assert.equal(todayLocalDate(), '2026-09-14');
});

test('historical Almaty datetime uses the offset on the event date', () => {
  process.env.TZ = 'UTC';
  assert.equal(serializeDateTimeLocal('2023-09-14T16:00'), '2023-09-14T10:00:00.000Z');
});

test('parallel expired requests share a single token refresh', async (t) => {
  const storage = new Map([['access', 'expired'], ['refresh', 'refresh-token']]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { location: { pathname: '/finance', href: '' }, dispatchEvent() {} };
  const axios = require('axios');
  let refreshes = 0;
  t.mock.method(axios, 'post', async () => {
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { data: { access: 'fresh' } };
  });
  const api = await loadApi();
  let attempts = 0;
  api.defaults.adapter = async (config) => {
    attempts += 1;
    if (config.headers.Authorization === 'Bearer expired') {
      throw new axios.AxiosError('Expired', 'ERR_BAD_REQUEST', config, null, { status: 401, data: {} });
    }
    return { config, status: 200, data: { ok: true }, headers: {} };
  };
  await Promise.all([api.get('finance/'), api.get('clients/'), api.get('subscriptions/')]);
  assert.equal(refreshes, 1);
  assert.equal(attempts, 6);
});

test('500 after token refresh is returned as 500 and does not clear auth', async (t) => {
  const storage = new Map([['access', 'expired'], ['refresh', 'refresh-token']]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { location: { pathname: '/finance', href: '' }, dispatchEvent() {} };
  const axios = require('axios');
  t.mock.method(axios, 'post', async () => ({ data: { access: 'fresh' } }));
  const api = await loadApi();
  api.defaults.adapter = async (config) => {
    const status = config._retry ? 500 : 401;
    throw new axios.AxiosError('Failed', 'ERR_BAD_RESPONSE', config, null, { status, data: {} });
  };
  await assert.rejects(api.get('finance/'), (error) => error.response.status === 500);
  assert.equal(storage.get('access'), 'fresh');
  assert.equal(window.location.href, '');
});

test('calendar navigation and month bounds do not shift in local timezone', () => {
  for (const zone of ['UTC', 'Asia/Almaty', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    assert.equal(addCalendarDays('2026-09-14', 1), '2026-09-15');
    assert.equal(addCalendarDays('2026-09-01', -1), '2026-08-31');
    assert.deepEqual(businessMonthRange('2026-09-14'), { date_from: '2026-09-01', date_to: '2026-09-30' });
    assert.deepEqual(businessMonthRange('2024-02-14'), { date_from: '2024-02-01', date_to: '2024-02-29' });
  }
});

test('finance metadata patch omits unchanged money and minute-rounded timestamp', async () => {
  const { normalizeItemForForm, normalizePayload } = await loadModule('pages/pageUtils.jsx');
  const original = { id: 1, amount: '100.00', paid_at: '2026-09-14T11:00:37Z', paid_at_precision: 'datetime', paid_on: '2026-09-14', comment: 'Old',
    payment_parts: [{ payment_method: 2, amount: '100.00' }] };
  const form = { ...normalizeItemForForm(original), comment: 'New' };
  assert.deepEqual(normalizePayload(form, original), { comment: 'New' });
  assert.deepEqual(normalizePayload({ ...form, amount: '120.00' }, original), { amount: '120.00', comment: 'New' });
  assert.equal(normalizePayload({ paid_at: '2026-09-14T16:00' }).paid_at, '2026-09-14T11:00:00.000Z');
});

test('finance master class payment rows use owner payment actions', async () => {
  const { financeRowActionKind, isMasterClassPaymentRow } = await loadModule('pages/FinancePage.jsx');
  const linked = { id: 1, source: 'master_class', master_class_id: 10, master_class_payment_id: 20 };

  assert.equal(isMasterClassPaymentRow(linked), true);
  assert.equal(financeRowActionKind(linked), 'master_class_payment');
  assert.equal(isMasterClassPaymentRow({ id: 2, source: 'master_class', master_class_id: 10 }), false);
  assert.equal(financeRowActionKind({ id: 3, source: 'manual' }), 'finance');
});

test('master class bulk rows keep independent discounts in payload and UI source', async () => {
  const masterClassesSource = await readFile(new URL('../src/pages/MasterClassesPage.jsx', import.meta.url), 'utf8');
  const {
    buildMasterClassBulkItems,
    calculateExtraMasterClassTotals,
    createExtraMasterClassFromForm,
  } = await loadModule('pages/MasterClassesPage.jsx');
  const form = {
    subject: '1',
    starts_at: '2026-09-14T16:00',
    duration_minutes: 60,
    price: '20000',
    discount: '10',
  };
  const extra = createExtraMasterClassFromForm(form);
  assert.equal(extra.discount, '');

  const items = buildMasterClassBulkItems({
    payload: { client: 1, branch: 2, manager: 3, subject: '1', starts_at: form.starts_at, duration_minutes: 60, price: '20000', discount: '10' },
    form,
    extraMasterClasses: [
      { ...extra, subject: '2', price: '26000', discount: '' },
      { ...extra, subject: '3', price: '15000', discount: '20' },
    ],
    normalize: (payload) => Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
  });

  assert.equal(items[0].discount, '10');
  assert.equal(items[1].discount, null);
  assert.equal(items[2].discount, '20');
  assert.equal(items[1].subject, '2');
  assert.equal(items[2].price, '15000');
  assert.equal(calculateExtraMasterClassTotals({ price: '15000' }, { discount_type: 'percentage', value: '20' }).totalAfterDiscount, 12000);
  assert.match(masterClassesSource, /<DiscountSelect value=\{item\.discount \|\| ''\}/);
  assert.match(masterClassesSource, /calculateExtraMasterClassTotals\(item, rowDiscount\)/);
  assert.doesNotMatch(masterClassesSource, /\.\.\.payload,[\s\S]{0,220}initial_payment: undefined,[\s\S]{0,80}\}\)\)/);
});

test('finance date formatter uses API precision across workstation timezones', () => {
  for (const zone of ['UTC', 'Asia/Almaty', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    assert.equal(formatFinanceDate({
      paid_at_precision: 'date',
      paid_on: '2026-09-14',
      paid_at: '2026-09-13T00:00:00Z',
    }), '14.09.2026');
    assert.equal(formatFinanceDate({
      paid_at_precision: 'datetime',
      paid_at: '2026-09-14T10:43:27Z',
    }), '14.09.2026, 15:43');
    assert.equal(formatDisplayDateTime('2026-09-14T10:43:00Z'), '14.09.2026, 15:43');
  }
});

test('table floating scrollbar visibility follows overflow and viewport position', async () => {
  const { hasHorizontalOverflow, shouldShowFloatingScrollbar } = await loadModule('components/ui/Table.jsx');

  assert.equal(hasHorizontalOverflow(1000, 800), true);
  assert.equal(hasHorizontalOverflow(801, 800), false);
  assert.equal(hasHorizontalOverflow(800, 800), false);
  assert.equal(shouldShowFloatingScrollbar({
    overflow: true,
    tableTop: -500,
    tableBottom: 1800,
    viewportHeight: 900,
  }), true);
  assert.equal(shouldShowFloatingScrollbar({
    overflow: false,
    tableTop: 120,
    tableBottom: 1400,
    viewportHeight: 900,
  }), false);
  assert.equal(shouldShowFloatingScrollbar({
    overflow: true,
    tableTop: 1000,
    tableBottom: 2000,
    viewportHeight: 900,
  }), false);
  assert.equal(shouldShowFloatingScrollbar({
    overflow: true,
    tableTop: -1000,
    tableBottom: 700,
    viewportHeight: 900,
  }), false);
  assert.equal(shouldShowFloatingScrollbar({
    overflow: true,
    tableTop: -2000,
    tableBottom: -100,
    viewportHeight: 900,
  }), false);
});

test('authenticated image helper loads protected media as blob and revokes object urls', async (t) => {
  const { canUseHoverPreview, fetchAuthenticatedImageObjectUrl, getHoverPreviewPosition, revokeAuthenticatedImageObjectUrl } = await loadModule('components/ui/AuthenticatedImage.jsx');
  const created = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    created.push(blob);
    return `blob:asset-${created.length}`;
  });
  t.mock.method(URL, 'revokeObjectURL', (objectUrl) => {
    revoked.push(objectUrl);
  });
  const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
  const requests = [];
  const apiClient = {
    async get(src, options) {
      requests.push({ src, options });
      return { data: blob };
    },
  };

  const objectUrl = await fetchAuthenticatedImageObjectUrl('/api/catalog-items/7/images/3/', apiClient);
  revokeAuthenticatedImageObjectUrl(objectUrl);

  assert.equal(objectUrl, 'blob:asset-1');
  assert.deepEqual(requests, [{ src: '/api/catalog-items/7/images/3/', options: { responseType: 'blob' } }]);
  assert.deepEqual(created, [blob]);
  assert.deepEqual(revoked, ['blob:asset-1']);
  assert.equal(canUseHoverPreview({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(canUseHoverPreview({ matchMedia: () => ({ matches: false }) }), false);
  assert.deepEqual(getHoverPreviewPosition({ left: 20, right: 64, top: 40 }, 900, 700), { left: 80, top: 40, width: 360, height: 360 });
  assert.deepEqual(getHoverPreviewPosition({ left: 820, right: 864, top: 500 }, 900, 700), { left: 444, top: 324, width: 360, height: 360 });
});

test('protected media previews use authenticated loader and product preview props', async () => {
  const settingsSource = await readFile(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  const financeSource = await readFile(new URL('../src/pages/FinancePage.jsx', import.meta.url), 'utf8');
  const imageSource = await readFile(new URL('../src/components/ui/AuthenticatedImage.jsx', import.meta.url), 'utf8');

  assert.match(settingsSource, /AuthenticatedImage/);
  assert.doesNotMatch(settingsSource, /<img\s+src=\{image\.thumbnail_url \|\| image\.url\}/);
  assert.doesNotMatch(settingsSource, /<img\s+src=\{item\.primary_image_url\}/);
  assert.match(settingsSource, /src=\{image\.thumbnail_url \|\| image\.url\}[\s\S]*?previewable[\s\S]*?hoverPreview/);
  assert.match(settingsSource, /src=\{item\.primary_image_url\}[\s\S]*?previewable[\s\S]*?hoverPreview/);
  assert.match(financeSource, /AuthenticatedImage/);
  assert.doesNotMatch(financeSource, /<img\s+[^>]*src=\{item\.thumbnail_url \|\| item\.url\}/);
  assert.match(financeSource, /openInNewTab/);
  assert.match(imageSource, /<HoverPreview objectUrl=\{objectUrl\}/);
  assert.match(imageSource, /<ImageLightbox objectUrl=\{objectUrl\}/);
  assert.match(imageSource, /document\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(imageSource, /if \(!openInNewTab\) return content/);
});

test('master class payment mismatches are visible in table, modal, kanban and filters', async () => {
  const { paymentCheckFilterParams, paymentCheckLabel } = await loadModule('pages/MasterClassesPage.jsx');
  const source = await readFile(new URL('../src/pages/MasterClassesPage.jsx', import.meta.url), 'utf8');
  assert.equal(paymentCheckLabel({ payment_status: 'paid', payment_attention_level: 'none' }), 'Всё сходится');
  assert.equal(paymentCheckLabel({ payment_mismatch_type: 'underpaid', payment_mismatch_amount: '1200.00' }), 'Недоплата 1 200 ₸');
  assert.equal(paymentCheckLabel({ payment_mismatch_type: 'overpaid', payment_mismatch_amount: '1000.00' }), 'Переплата 1 000 ₸');
  assert.deepEqual(paymentCheckFilterParams('issue'), { payment_issue: '1', payment_status: '' });
  assert.deepEqual(paymentCheckFilterParams('paid'), { payment_issue: '', payment_status: 'paid' });
  assert.match(source, /function PaymentCheckBadge/);
  assert.match(source, /Расхождение/);
  assert.match(source, /rowClassName=\{\(row\)/);
  assert.match(source, /Есть несостыковка в оплате/);
  assert.match(source, /Внести остаток/);
  assert.match(source, /item\.has_payment_mismatch && <div className="mt-3">/);
  assert.match(source, /Расхождений: \{paymentIssueCount\}/);
  assert.match(source, /payment_issue: '1'/);
  assert.match(source, /payment_attention_level === 'critical'/);
  assert.match(source, /Всё сходится/);
});

test('master class event range is primary and payment range stays independent', async () => {
  const { updateEventRangeFilters } = await loadModule('pages/MasterClassesPage.jsx');
  const source = await readFile(new URL('../src/pages/MasterClassesPage.jsx', import.meta.url), 'utf8');
  const initial = { event_date_from: '', event_date_to: '', payment_date_from: '', payment_date_to: '' };
  const withStart = updateEventRangeFilters(initial, 'event_date_from', '2026-09-01');
  const complete = updateEventRangeFilters(withStart.filters, 'event_date_to', '2026-09-15');
  const invalid = updateEventRangeFilters(complete.filters, 'event_date_from', '2026-09-20');
  assert.equal(complete.filters.event_date_from, '2026-09-01');
  assert.equal(complete.filters.event_date_to, '2026-09-15');
  assert.equal(invalid.error, 'Дата «от» не может быть позже даты «до».');
  assert.deepEqual(invalid.filters, complete.filters);
  assert.match(source, /search: '', event_date_from: '', event_date_to: '', stage: ''/);
  assert.match(source, /label="Проведение от"[\s\S]*?event_date_from/);
  assert.match(source, /label="Проведение до"[\s\S]*?event_date_to/);
  assert.match(source, /label="Оплата от"[\s\S]*?payment_date_from/);
  assert.match(source, /label="Оплата до"[\s\S]*?payment_date_to/);
  assert.doesNotMatch(source, /label="Дата проведения"/);
  assert.doesNotMatch(source, /event_date: ''/);
  assert.match(source, /const params = \{ \.\.\.crud\.filters, outside_regular_hours: 'true'/);
});

test('employee schedule grid requests one effective date and saves through versioning', async () => {
  const source = await readFile(new URL('../src/pages/EmployeeSchedulePage.jsx', import.meta.url), 'utf8');
  assert.match(source, /effective_on: scheduleDate/);
  assert.match(source, /employee-schedules\/set-from-date\//);
  assert.doesNotMatch(source, /api\.patch\(`employee-schedules/);
  assert.match(source, /min=\{todayIso\(\)\}/);
});

for (const status of [401, 500]) {
  test(`refresh ${status} propagates its status and only 401 clears auth`, async (t) => {
    const storage = new Map([['access', 'expired'], ['refresh', 'refresh-token']]);
    globalThis.localStorage = {
      getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    globalThis.window = { location: { pathname: '/finance', href: '' }, dispatchEvent() {} };
    const axios = require('axios');
    t.mock.method(axios, 'post', async () => {
      throw new axios.AxiosError('Refresh failed', 'ERR_BAD_RESPONSE', {}, null, { status, data: {} });
    });
    const api = await loadApi();
    let attempts = 0;
    api.defaults.adapter = async (config) => {
      attempts += 1;
      throw new axios.AxiosError('Expired', 'ERR_BAD_REQUEST', config, null, { status: 401, data: {} });
    };
    await assert.rejects(api.get('finance/'), (error) => error.response.status === status);
    assert.equal(attempts, 1);
    assert.equal(storage.get('refresh'), status === 401 ? undefined : 'refresh-token');
    assert.equal(window.location.href, status === 401 ? '/login' : '');
  });
}

test('retried 401 logs out without a second refresh', async (t) => {
  const storage = new Map([['access', 'expired'], ['refresh', 'refresh-token']]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { location: { pathname: '/finance', href: '' }, dispatchEvent() {} };
  const axios = require('axios');
  let refreshes = 0;
  t.mock.method(axios, 'post', async () => {
    refreshes += 1;
    return { data: { access: 'fresh' } };
  });
  const api = await loadApi();
  let attempts = 0;
  api.defaults.adapter = async (config) => {
    attempts += 1;
    throw new axios.AxiosError('Expired', 'ERR_BAD_REQUEST', config, null, { status: 401, data: {} });
  };
  await assert.rejects(api.get('finance/'), (error) => error.response.status === 401);
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
  assert.equal(storage.get('access'), undefined);
  assert.equal(window.location.href, '/login');
});
