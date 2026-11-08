import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeliveryDate, toDeliverySqlDate, getGhnDeliveryDate, shouldRefreshDelivery } from '../src/delivery-estimate.js';
import { refreshOrderDelivery } from '../src/services/order-delivery.service.js';
import { pool } from '../src/config/db.js';
import { saveGhnShipment } from '../src/models/promotional-order.model.js';

test('GHN dates support ISO offsets, Unix seconds/milliseconds and Vietnam SQL timestamps', () => {
  const iso = '2026-11-10T16:59:59.000Z';
  assert.equal(normalizeDeliveryDate('2026-11-10T23:59:59+07:00'), iso);
  assert.equal(normalizeDeliveryDate(Date.parse(iso) / 1000), iso);
  assert.equal(normalizeDeliveryDate(Date.parse(iso)), iso);
  assert.equal(normalizeDeliveryDate(String(Date.parse(iso) / 1000)), iso);
  assert.equal(normalizeDeliveryDate('2026-11-10 23:59:59'), iso);
  assert.equal(toDeliverySqlDate(iso), '2026-11-10 23:59:59');
  for (const value of [null, '', 0, 'invalid', '0001-01-01T00:00:00Z', {}, true, Infinity]) {
    assert.equal(normalizeDeliveryDate(value), null);
  }
  assert.equal(getGhnDeliveryDate({ expected_delivery_time: '', leadtime: iso }), iso);
});

test('only active orders with a shipment refresh, with a 15 minute cooldown', () => {
  const now = Date.parse('2026-11-08T04:00:00Z');
  const order = { status: 'processing', ghn_order_code: 'TEST', ghn_status: 'ready_to_pick' };
  assert.equal(shouldRefreshDelivery(order, now), true);
  assert.equal(shouldRefreshDelivery({ ...order, ghn_delivery_checked_at: '2026-11-08T03:46:00Z' }, now), false);
  assert.equal(shouldRefreshDelivery({ ...order, ghn_delivery_checked_at: '2026-11-08T03:45:00Z' }, now), true);
  for (const status of ['pending', 'confirmed', 'cancelled', 'delivered']) {
    assert.equal(shouldRefreshDelivery({ ...order, status }, now), false);
  }
  for (const ghn_status of ['cancel', 'delivered', 'returned', 'lost', 'damage']) {
    assert.equal(shouldRefreshDelivery({ ...order, ghn_status }, now), false);
  }
  assert.equal(shouldRefreshDelivery({ ...order, ghn_order_code: null }, now), false);
  assert.equal(shouldRefreshDelivery({ ...order, status: 'shipped' }, now), true);
});

test('refresh and persistence use real GHN response fields and preserve the last estimate on failure', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalExecute = pool.execute;
  const originalConnection = pool.getConnection;
  const originalEnv = { ...process.env };
  Object.assign(process.env, { GHN_TOKEN: 'test-token', GHN_SHOP_ID: '235503', GHN_API_URL: 'https://dev-online-gateway.ghn.vn' });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    pool.execute = originalExecute;
    pool.getConnection = originalConnection;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await pool.end();
  });
  pool.getConnection = async () => ({ execute: (...args) => pool.execute(...args), beginTransaction: async()=>{}, commit: async()=>{}, rollback: async()=>{}, release(){} });
  const writes = [];
  pool.execute = async (sql, args) => { writes.push({ sql, args }); return [{ affectedRows: 1 }]; };
  const order = {
    id: 24, status: 'processing', ghn_order_code: 'GHN-TEST-24', ghn_status: 'ready_to_pick',
    ghn_expected_delivery_at: '2026-11-09T16:59:59.000Z',
  };
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.ok(url.endsWith('/shipping-order/detail?order_code=GHN-TEST-24'));
    return { ok: true, json: async () => ({ code: 200, data: { leadtime: '2026-11-10T16:59:59Z' } }) };
  };
  const refreshed = await refreshOrderDelivery(order);
  assert.equal(refreshed.ghn_expected_delivery_at, '2026-11-10T16:59:59.000Z');
  assert.equal(writes[0].args[0], '2026-11-10 23:59:59');
  await refreshOrderDelivery(refreshed);
  assert.equal(calls, 1);
  await refreshOrderDelivery(refreshed, { force: true });
  assert.equal(calls, 2);
  await refreshOrderDelivery({ ...order, status: 'confirmed' }, { force: true });
  assert.equal(calls, 2);

  globalThis.fetch = async () => { throw new Error('offline'); };
  const failed = await refreshOrderDelivery(order);
  assert.equal(failed.ghn_expected_delivery_at, order.ghn_expected_delivery_at);
  assert.ok(failed.ghn_delivery_checked_at);
  assert.equal(writes.at(-1).args[0], null);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await pending;
    return { ok: true, json: async () => ({ code: 200, data: { leadtime: '2026-11-11T16:59:59Z' } }) };
  };
  const first = refreshOrderDelivery(order);
  const second = refreshOrderDelivery(order);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(results[0].ghn_expected_delivery_at, results[1].ghn_expected_delivery_at);

  let updateArgs;
  pool.execute = async (sql, args) => {
    if (sql.startsWith('UPDATE orders SET ghn_order_code')) {
      updateArgs = args;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO order_events')) return [{insertId:123}];
    if (sql.startsWith('INSERT INTO notifications')) return [{insertId:456}];
    if (sql.includes('FROM orders WHERE id')) return [[{
      ...order, ghn_expected_delivery_at: '2026-11-12 23:59:59', ghn_delivery_checked_at: '2026-11-08 12:00:00',
    }]];
    if (sql.includes('FROM order_items') || sql.includes('FROM promotion_usages')) return [[]];
    throw new Error('Unexpected SQL: ' + sql);
  };
  const saved = await saveGhnShipment(24, {
    orderCode: 'GHN-TEST-24', status: 'ready_to_pick', fee: 82500, paymentTypeId: 2,
    shopId: 235503, serviceTypeId: 2, length: 20, width: 15, height: 10,
    expectedDeliveryTime: '2026-11-12T16:59:59Z',
  });
  assert.equal(updateArgs.at(-2), '2026-11-12 23:59:59');
  assert.equal(saved.ghn_expected_delivery_at, '2026-11-12T16:59:59.000Z');
});
