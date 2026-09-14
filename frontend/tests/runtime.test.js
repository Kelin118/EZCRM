import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
