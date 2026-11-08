import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { pool } from '../src/config/db.js';
import { validatePaymentMethod, getCodAmount, codPaymentOutcome } from '../src/order-payment.js';

test('COD validation and amount use discounted merchandise, excluding separately collected shipping', () => {
  assert.equal(validatePaymentMethod(), 'cod');
  assert.equal(validatePaymentMethod('cod'), 'cod');
  assert.equal(validatePaymentMethod('vnpay'), 'vnpay');
  assert.equal(getCodAmount({ payment_method: 'vnpay', subtotal: 113000, discount_amount: 100000 }), 0);
  for (const value of [null, '', 'cash', 'COD', 1, {}, []]) {
    assert.throws(() => validatePaymentMethod(value), error => error.status === 400);
  }
  assert.equal(getCodAmount({ payment_method: 'cod', subtotal: '113000', discount_amount: '100000', shipping_fee: 82500, cod_amount: 95500 }), 13000);
  assert.equal(getCodAmount({ subtotal: 100000, discount_amount: 100000, shipping_fee: 15000 }), 0);
  for (const subtotal of [-1, NaN, Infinity, 50000001]) {
    assert.throws(() => getCodAmount({ subtotal }), error => error.status === 400);
  }
  assert.equal(codPaymentOutcome('delivered'), 'paid');
  assert.equal(codPaymentOutcome('cancelled'), 'cancelled');
  assert.equal(codPaymentOutcome('returned'), 'cancelled');
  assert.equal(codPaymentOutcome('delivery_fail'), null);
});

test('HTTP COD checkout, VNPAY rejection, authorization and payment lifecycle', async (t) => {
  const oldEnv = { ...process.env };
  const oldExecute = pool.execute;
  const oldGetConnection = pool.getConnection;
  Object.assign(process.env, { JWT_SECRET: 'cod-tests-secret-at-least-32-characters', GHN_TOKEN: '', GHN_SHOP_ID: '', GHN_WEBHOOK_SECRET: 'cod-webhook-secret' });
  let nextId = 100;
  let stock = 20;
  const records = new Map();
  const items = new Map();

  const execute = async (sql, args = []) => {
    if(sql.startsWith('INSERT INTO order_events'))return [{insertId:1}];
    if(sql.startsWith('INSERT INTO notifications'))return [{insertId:1}];
    if(sql.includes('FROM orders WHERE id=?')) { const row=records.get(args[0]);return [row?[{...row}]:[]]; }
    if(sql.includes('FROM orders WHERE ghn_order_code=?')) { const row=[...records.values()].find(x=>x.ghn_order_code===args[0]);return [row?[{...row}]:[]]; }
    if(sql.startsWith('UPDATE orders SET ghn_status=?')){records.get(args[1]).ghn_status=args[0];return [{affectedRows:1}];}
    if (sql.includes('FROM users WHERE id = ?')) return [[{ id: args[0], role: args[0] === 1 ? 'admin' : 'customer', is_active: 1 }]];
    if (sql.includes('FROM books WHERE id IN')) return [[{ id: 1, title: 'Book', category_id: 1, price: 113000, stock_quantity: stock, is_active: 1, weight_grams: 300 }]];
    if (sql.includes('FROM product_promotion_books ppb') || sql.includes('SELECT p.*')) return [[]];
    if (sql.startsWith('INSERT INTO orders')) {
      assert.equal((sql.match(/\?/g) || []).length, args.length);
      const row = { id: ++nextId, user_id: args[0], order_code: args[1], recipient_name: args[2], recipient_phone: args[3], shipping_address: args[4], subtotal: args[5], direct_discount_amount: args[6], total_amount: args[7], discount_amount: args[8], cod_amount: args[11], payment_method: args.at(-1), payment_status: 'unpaid', paid_at: null, status: 'pending', shipping_fee: 0 };
      records.set(row.id, row);
      return [{ insertId: row.id }];
    }
    if (sql.startsWith('INSERT INTO order_items')) {
      const row = { order_id: args[0], book_id: args[1], book_title: args[2], unit_price: args[3], quantity: args[8], weight_grams: args[9] };
      items.set(args[0], [row]);
      return [{ insertId: args[0] }];
    }
    if (sql.startsWith('UPDATE books SET stock_quantity = stock_quantity -')) { stock -= args[0]; return [{ affectedRows: 1 }]; }
    if (sql.includes('FROM orders WHERE id = ?')) {
      const row = records.get(args[0]); return [row ? [{ ...row }] : []];
    }
    if (sql.includes('FROM order_items oi')) return [args.flatMap(id => items.get(id) || [])];
    if (sql.includes('FROM promotion_usages')) return [[]];
    if (sql.startsWith('UPDATE promotion_usages')) return [{ affectedRows: 0 }];
    if (sql.startsWith('UPDATE orders SET paid_at')) {
      assert.ok(sql.includes("payment_method = 'cod' AND payment_status = 'unpaid'"));
      const row = sql.includes('WHERE ghn_order_code') ? [...records.values()].find(x => x.ghn_order_code === args[2]) : records.get(args[2]);
      if (!row || row.payment_method !== 'cod' || row.payment_status !== 'unpaid') return [{ affectedRows: 0 }];
      row.payment_status = args[1];
      if (args[0] === 'paid') row.paid_at ||= '2026-11-08 15:00:00';
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE orders SET ghn_delivery_checked_at')) {
      const row = [...records.values()].find(x => x.ghn_order_code === args[2]);
      if (row) row.ghn_status = args[1];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('UPDATE orders SET ghn_status')) { records.get(args[1]).ghn_status = args[0]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE orders SET status')) { records.get(args[2]).status = args[0]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE books b JOIN')) { stock += items.get(args[0]).reduce((sum, row) => sum + row.quantity, 0); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE product_promotion_books ppb')) return [{ affectedRows: 0 }];
    throw new Error('Unexpected SQL: ' + sql);
  };
  pool.execute = execute;
  pool.getConnection = async () => ({ execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    pool.execute = oldExecute; pool.getConnection = oldGetConnection;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    await pool.end();
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const token = (id) => jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
  const call = async (method, path, body, userId = 8, extraHeaders = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(userId), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const input = { recipient_name: 'Customer', recipient_phone: '0900000000', shipping_address: '123 Test street', items: [{ book_id: 1, quantity: 1 }], payment_method: 'cod' };

  await t.test('creates unpaid COD order from server prices; older clients default to COD', async () => {
    const created = await call('POST', '/orders', input);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.payment_method, 'cod');
    assert.equal(created.body.data.payment_status, 'unpaid');
    assert.equal(created.body.data.cod_amount, 113000);
    assert.equal(created.body.data.paid_at, null);
    const legacy = { ...input }; delete legacy.payment_method;
    assert.equal((await call('POST', '/orders', legacy)).body.data.payment_method, 'cod');
    assert.equal(stock, 18);
  });

  await t.test('rejects invalid methods and client-supplied payment results before changing stock', async () => {
    assert.equal((await call('POST', '/orders', { ...input, payment_method: 'other' })).status, 400);
    for (const fields of [{ payment_status: 'paid' }, { cod_amount: 1 }, { paid_at: '2026-11-08' }, { total_amount: 1 }]) {
      assert.equal((await call('POST', '/orders', { ...input, ...fields })).status, 400);
    }
    assert.equal(stock, 18);
    assert.equal(records.size, 2);
  });

  await t.test('customer can only read their payment and cannot mark an order delivered', async () => {
    assert.equal((await call('GET', '/orders/101', null)).body.data.payment_status, 'unpaid');
    assert.equal((await call('GET', '/orders/101', null, 9)).status, 404);
    assert.equal((await call('PATCH', '/admin/orders/101/status', { status: 'delivered' })).status, 403);
  });

  await t.test('admin delivery records payment; cancellation releases unpaid COD and restores stock', async () => {
    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      const result = await call('PATCH', '/admin/orders/101/status', { status }, 1);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.payment_status, status === 'delivered' ? 'paid' : 'unpaid');
    }
    const paid = await call('GET', '/orders/101', null);
    assert.equal(paid.body.data.paid_at, '2026-11-08T08:00:00.000Z');
    const cancelled = await call('PATCH', '/admin/orders/102/status', { status: 'cancelled' }, 1);
    assert.equal(cancelled.body.data.payment_status, 'cancelled');
    assert.equal(cancelled.body.data.paid_at, null);
    assert.equal(stock, 19);
  });

  await t.test('authenticated GHN delivery marks COD paid, repeated events do not undo it', async () => {
    const created = await call('POST', '/orders', input);
    const row = records.get(created.body.data.id);
    row.ghn_order_code = 'GHN-COD-TEST';
    Object.assign(process.env, { GHN_TOKEN: 'test-token', GHN_SHOP_ID: '235503' });
    const event = { ShopID: 235503, OrderCode: row.ghn_order_code, Status: 'delivered' };
    assert.equal((await call('POST', '/webhooks/ghn/orders', event, 8, { 'x-ghn-webhook-secret': 'wrong' })).status, 401);
    assert.equal(row.payment_status, 'unpaid');
    for (const Status of ['delivered', 'delivered', 'cancel']) {
      assert.equal((await call('POST', '/webhooks/ghn/orders', { ...event, Status }, 8, { 'x-ghn-webhook-secret': 'cod-webhook-secret' })).status, 200);
      assert.equal(row.payment_status, 'paid');
      assert.equal(row.paid_at, '2026-11-08 15:00:00');
    }
  });
});
