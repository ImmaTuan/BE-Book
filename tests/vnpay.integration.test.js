import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/db.js';
import { app } from '../src/app.js';
import { getVnpayConfig } from '../src/config/vnpay.js';
import { signVnpayParams, QUERY_RESPONSE_FIELDS } from '../src/services/vnpay.service.js';
import { createVnpayPayment, latestVnpayPayment, settleVnpayPayment } from '../src/models/vnpay-payment.model.js';
import { updateOrderStatus, saveGhnShipment } from '../src/models/promotional-order.model.js';

test('VNPAY HTTP callbacks and payment persistence on MySQL, all test data rolled back', { skip: process.env.RUN_VNPAY_MYSQL_TEST !== '1' }, async (t) => {
  const originalFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { VNP_LOCAL_RETURN_CONFIRM: 'false', VNP_TMN_CODE: 'TESTCODE', VNP_HASH_SECRET: 'test-secret-only', VNP_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', VNP_RETURN_URL: 'http://localhost:3000/api/payments/vnpay/return', VNP_FRONTEND_URL: 'http://localhost:5173', JWT_SECRET: 'vnpay-test-secret-at-least-32-characters' });
  const db = await pool.getConnection();
  await db.beginTransaction();
  const executeOriginal = pool.execute;
  const connectionOriginal = pool.getConnection;
  // Keep the actual SQL and locking, but let the outer test transaction own
  // commit/rollback so no fixtures or changes survive this test.
  pool.execute = db.execute.bind(db);
  pool.getConnection = async () => ({ execute: db.execute.bind(db), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    pool.execute = executeOriginal; pool.getConnection = connectionOriginal;
    await db.rollback(); db.release(); await pool.end();
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });
  const [[owner]] = await db.execute("SELECT id FROM users WHERE role = 'customer' AND is_active = 1 LIMIT 1");
  assert.ok(owner, 'An active customer is required');
  const makeOrder = async () => {
    const [created] = await db.execute(
      "INSERT INTO orders (user_id, order_code, recipient_name, recipient_phone, shipping_address, subtotal, direct_discount_amount, discount_amount, shipping_fee, total_amount, status, payment_method, payment_status, cod_amount) VALUES (?, ?, 'VNPAY test', '0900000000', 'Test', 113000, 0, 100000, 0, 13000, 'pending', 'vnpay', 'unpaid', 0)",
      [owner.id, 'VNPAY-TEST-' + randomBytes(8).toString('hex')],
    );
    return created.insertId;
  };
  const state = async (id) => (await db.execute('SELECT * FROM orders WHERE id = ?', [id]))[0][0];
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const config = getVnpayConfig();
  const callback = (attempt, extra = {}) => {
    const params = { vnp_TmnCode: config.tmnCode, vnp_TxnRef: attempt.reference, vnp_Amount: String(attempt.amount * 100), vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: String(100000000 + attempt.order_id), ...extra };
    return { ...params, vnp_SecureHash: signVnpayParams(params, config.hashSecret) };
  };
  const requestCallback = async (path, params) => fetch(baseUrl + path + '?' + new URLSearchParams(params), { redirect: 'manual' });
  const orderId = await makeOrder();
  const attempt = await createVnpayPayment(orderId, owner.id, 82500, '127.0.0.1');

  await t.test('freezes 95500 total including shipping and reuses a pending session', async () => {
    assert.equal(attempt.amount, 95500);
    assert.equal((await state(orderId)).cod_amount, 0);
    assert.equal((await createVnpayPayment(orderId, owner.id, 99999, '127.0.0.1')).reference, attempt.reference);
    await assert.rejects(createVnpayPayment(orderId, -1, 1, '127.0.0.1'), error => error.status === 404);
  });

  await t.test('unpaid VNPAY cannot be confirmed or shipped by admin', async () => {
    await assert.rejects(updateOrderStatus(orderId, 'confirmed'), error => error.status === 409);
  });

  await t.test('Return URL never marks paid and redirects to fixed configured frontend', async () => {
    const response = await requestCallback('/api/payments/vnpay/return', callback(attempt));
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('location')).origin, 'http://localhost:5173');
    assert.equal((await state(orderId)).payment_status, 'unpaid');
  });

  await t.test('IPN rejects tampering and amount mismatch without changing payment', async () => {
    const tampered = { ...callback(attempt), vnp_Amount: '100' };
    assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', tampered)).json()).RspCode, '97');
    assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', callback(attempt, { vnp_Amount: '100' }))).json()).RspCode, '04');
    assert.equal((await state(orderId)).payment_status, 'unpaid');
  });

  await t.test('valid IPN records paid once, duplicate and later failure cannot reverse payment', async () => {
    const params = callback(attempt);
    assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', params)).json()).RspCode, '00');
    const paidAt = (await state(orderId)).paid_at;
    assert.ok(paidAt);
    assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', params)).json()).RspCode, '02');
    const failure = callback(attempt, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' });
    assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', failure)).json()).RspCode, '02');
    assert.equal((await state(orderId)).payment_status, 'paid');
    assert.equal((await state(orderId)).paid_at, paidAt);
    await assert.rejects(updateOrderStatus(orderId, 'cancelled'), error => error.status === 409);
  });

  await t.test('shipping paid VNPAY preserves the already charged total and fee', async () => {
    await saveGhnShipment(orderId, { orderCode: 'VNPTEST' + orderId, status: 'ready_to_pick', fee: 90000, paymentTypeId: 1, shopId: 235503, serviceTypeId: 2, length: 20, width: 15, height: 10, expectedDeliveryTime: null });
    const order = await state(orderId);
    assert.equal(order.total_amount, 95500);
    assert.equal(order.shipping_fee, 82500);
    assert.equal(order.cod_amount, 0);
  });

  await t.test('failed payment can retry with a new reference, late success after cancellation needs refund review', async () => {
    const id = await makeOrder();
    const failed = await createVnpayPayment(id, owner.id, 82500, '127.0.0.1');
    await settleVnpayPayment(callback(failed, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' }));
    assert.equal((await state(id)).payment_status, 'failed');
    const retry = await createVnpayPayment(id, owner.id, 82500, '127.0.0.1');
    assert.notEqual(retry.reference, failed.reference);
    await updateOrderStatus(id, 'cancelled');
    await settleVnpayPayment(callback(retry, { vnp_TransactionNo: String(200000000 + id) }));
    assert.equal((await state(id)).payment_status, 'refund_required');
    assert.equal((await state(id)).status, 'cancelled');
  });

  await t.test('customers cannot pay or check someone else order, or submit an amount', async () => {
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(owner.id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
    const post = (id, body) => fetch(baseUrl + '/api/orders/' + id + '/payments/vnpay', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    assert.equal((await post(orderId, { amount: 1 })).status, 400);
    assert.equal((await post(2147483647, {})).status, 404);
    assert.equal((await latestVnpayPayment(orderId)).status, 'succeeded');
  });

  let checkoutOrder;
  await t.test('checkout creates the full VNPAY payment including GHN preview, without creating a shipment', async () => {
    const [[book]] = await db.execute('SELECT id FROM books WHERE is_active = 1 AND stock_quantity > 0 ORDER BY id LIMIT 1');
    assert.ok(book, 'An available book is required');
    Object.assign(process.env, { GHN_TOKEN: 'test-token', GHN_SHOP_ID: '235503', GHN_API_URL: 'https://dev-online-gateway.ghn.vn' });
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://dev-online-gateway.ghn.vn')) {
        const path = new URL(url).pathname;
        if (path.endsWith('/shop/all')) return { ok: true, json: async () => ({ code: 200, data: { shops: [{ _id: 235503, is_new_address: true }] } }) };
        assert.ok(path.endsWith('/shipping-order/preview'), 'Only preview is allowed before payment');
        const payload = JSON.parse(options.body);
        assert.equal(payload.cod_amount, 0);
        assert.equal(payload.payment_type_id, 1);
        return { ok: true, json: async () => ({ code: 200, data: { total_fee: 82500 } }) };
      }
      return originalFetch(url, options);
    };
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(owner.id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
    const response = await originalFetch(baseUrl + '/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ recipient_name: 'VNPAY checkout test', recipient_phone: '0900000000', shipping_address: 'Test street', to_ward_name: 'Test ward', to_province_name: 'Test province', is_new_to_address: true, payment_method: 'vnpay', items: [{ book_id: book.id, quantity: 1 }] }),
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.ok(result.payment?.url);
    assert.equal(new URL(result.payment.url).hostname, 'sandbox.vnpayment.vn');
    assert.equal(Number(result.data.shipping_fee), 82500);
    assert.equal(result.data.ghn_order_code, null);
    assert.equal(Number(result.data.cod_amount), 0);
    assert.equal(result.data.payment_status, 'unpaid');
    checkoutOrder = result.data;
  });

  await t.test('local authenticated QueryDR check establishes payment independently of Return/IPN', async () => {
    const attempt = await latestVnpayPayment(checkoutOrder.id);
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('sandbox.vnpayment.vn/merchant_webapi')) {
        const params = {
          vnp_ResponseId: 'QUERY-TEST', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'Success',
          vnp_TmnCode: config.tmnCode, vnp_TxnRef: attempt.reference, vnp_Amount: String(Number(attempt.amount) * 100),
          vnp_BankCode: 'NCB', vnp_PayDate: '20261108110000', vnp_TransactionNo: String(300000000 + checkoutOrder.id),
          vnp_TransactionType: '01', vnp_TransactionStatus: '00', vnp_OrderInfo: 'Test', vnp_PromotionCode: '', vnp_PromotionAmount: '',
        };
        params.vnp_SecureHash = createHmac('sha512', config.hashSecret).update(QUERY_RESPONSE_FIELDS.map(key => params[key] ?? '').join('|')).digest('hex');
        return { ok: true, json: async () => params };
      }
      return originalFetch(url, options);
    };
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(owner.id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
    const response = await originalFetch(baseUrl + '/api/orders/' + checkoutOrder.id + '/payments/vnpay/check', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.payment_status, 'paid');
    assert.equal(result.data.ghn_order_code, null);
    assert.equal(Number(result.data.cod_amount), 0);
  });

  await t.test('explicit local sandbox mode validates signed Return, marks paid once and no longer depends on QueryDR', async () => {
    process.env.VNP_LOCAL_RETURN_CONFIRM = 'true';
    try {
      const id = await makeOrder();
      const payment = await createVnpayPayment(id, owner.id, 82500, '127.0.0.1');
      const params = callback(payment, { vnp_TransactionNo: String(400000000 + id) });
      const tampered = await requestCallback('/api/payments/vnpay/return', { ...params, vnp_Amount: '100' });
      assert.equal(new URL(tampered.headers.get('location')).searchParams.get('result'), 'invalid');
      assert.equal((await state(id)).payment_status, 'unpaid');
      const wrongAmount = await requestCallback('/api/payments/vnpay/return', callback(payment, { vnp_Amount: '100', vnp_TransactionNo: String(400000000 + id) }));
      assert.equal(new URL(wrongAmount.headers.get('location')).searchParams.get('result'), 'invalid');
      assert.equal((await state(id)).payment_status, 'unpaid');
      const returned = await requestCallback('/api/payments/vnpay/return', params);
      assert.equal(returned.status, 303);
      assert.equal((await state(id)).payment_status, 'paid');
      const paidAt = (await state(id)).paid_at;
      await requestCallback('/api/payments/vnpay/return', params);
      assert.equal((await state(id)).payment_status, 'paid');
      assert.equal((await state(id)).paid_at, paidAt);
      assert.equal((await (await requestCallback('/api/payments/vnpay/ipn', params)).json()).RspCode, '02');
      globalThis.fetch = async (url, options) => {
        assert.ok(!String(url).includes('merchant_webapi'), 'Paid local Return must not require QueryDR');
        return originalFetch(url, options);
      };
      const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(owner.id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
      const checked = await originalFetch(baseUrl + '/api/orders/' + id + '/payments/vnpay/check', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      assert.equal(checked.status, 200);
      assert.equal((await checked.json()).data.payment_status, 'paid');

      const failedId = await makeOrder();
      const failed = await createVnpayPayment(failedId, owner.id, 82500, '127.0.0.1');
      await requestCallback('/api/payments/vnpay/return', callback(failed, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' }));
      assert.equal((await state(failedId)).payment_status, 'failed');
    } finally {
      process.env.VNP_LOCAL_RETURN_CONFIRM = 'false';
    }
  });

  await t.test('customer filters apply before pagination and cannot expose other accounts orders', async () => {
    const prefix = 'FILTER-' + randomBytes(5).toString('hex') + '-';
    const ids = [];
    for (const suffix of ['A', 'B', 'C', 'PRIVATE']) {
      const id = await makeOrder(); ids.push(id);
      await db.execute('UPDATE orders SET order_code = ? WHERE id = ?', [prefix + suffix, id]);
    }
    await db.execute("UPDATE orders SET payment_status = 'paid' WHERE id = ?", [ids[0]]);
    await db.execute("UPDATE orders SET payment_method = 'cod', status = 'shipped' WHERE id = ?", [ids[1]]);
    const [[other]] = await db.execute('SELECT id FROM users WHERE id <> ? LIMIT 1', [owner.id]);
    assert.ok(other);
    await db.execute("UPDATE orders SET user_id = ?, payment_status = 'paid' WHERE id = ?", [other.id, ids[3]]);
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(owner.id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
    const get = async (query) => {
      const response = await originalFetch(baseUrl + '/api/orders?' + new URLSearchParams(query), { headers: { Authorization: 'Bearer ' + token } });
      return { status: response.status, body: await response.json() };
    };
    const all = await get({ search: prefix, limit: '1', page: '2', user_id: String(other.id) });
    assert.equal(all.status, 200);
    assert.equal(all.body.meta.total, 3);
    assert.equal(all.body.data.length, 1);
    assert.equal(all.body.data[0].user_id, owner.id);
    const filtered = await get({ search: prefix, status: 'pending', payment_status: 'paid', payment_method: 'vnpay' });
    assert.equal(filtered.body.meta.total, 1);
    assert.equal(filtered.body.data[0].id, ids[0]);
    const none = await get({ search: prefix + "%' OR 1=1 --" });
    assert.equal(none.body.meta.total, 0);
    for (const query of [{ status: 'unknown' }, { payment_status: 'unknown' }, { payment_method: 'cash' }, { search: 'x'.repeat(101) }]) {
      assert.equal((await get(query)).status, 400);
    }
  });
});
