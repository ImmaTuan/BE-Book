import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../src/config/db.js';
import { app } from '../src/app.js';
import { dashboardRange } from '../src/dashboard-periods.js';
import { getDashboard } from '../src/models/dashboard.model.js';

test('dashboard MySQL revenue, shipping, dates and admin authorization (all fixtures rolled back)', { skip: process.env.RUN_DASHBOARD_MYSQL_TEST !== '1' }, async (t) => {
  const originalExecute = pool.execute, originalConnection = pool.getConnection, oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'dashboard-tests-secret-at-least-32-characters';
  const db = await pool.getConnection();
  await db.beginTransaction();
  pool.execute = db.execute.bind(db);
  pool.getConnection = async () => ({ execute: db.execute.bind(db), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    pool.execute = originalExecute; pool.getConnection = originalConnection;
    await db.rollback(); db.release(); await pool.end();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  });
  const [[admin]] = await db.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1");
  const [[customer]] = await db.execute("SELECT id FROM users WHERE role = 'customer' AND is_active = 1 LIMIT 1");
  const [[book]] = await db.execute('SELECT id FROM books LIMIT 1');
  assert.ok(admin && customer && book);
  const range = dashboardRange({ period: 'month', from: '2098-01-01', to: '2098-03-31' });
  const baseline = await getDashboard(range);
  assert.equal(baseline.summary.orders, 0);
  const insert = async ({ total, fee, paid = '2098-01-05 12:00:00', created = '2098-01-02 10:00:00', status = 'pending', payment = 'paid', ghn = null, quantity = 1 }) => {
    const [row] = await db.execute(
      "INSERT INTO orders (user_id, order_code, recipient_name, recipient_phone, shipping_address, subtotal, direct_discount_amount, discount_amount, shipping_fee, total_amount, status, payment_method, payment_status, cod_amount, paid_at, created_at, ghn_status) VALUES (?, ?, 'Dashboard test', '0900000000', 'Test', ?, 0, 0, ?, ?, ?, 'vnpay', ?, 0, ?, ?, ?)",
      [customer.id, 'DASH-TEST-' + randomBytes(7).toString('hex'), total - fee, fee, total, status, payment, paid, created, ghn],
    );
    await db.execute(
      "INSERT INTO order_items (order_id, book_id, book_title, unit_price, original_unit_price, quantity, weight_grams) VALUES (?, ?, 'Dashboard book', 10000, 10000, ?, 300)",
      [row.insertId, book.id, quantity],
    );
  };
  await insert({ total: 95500, fee: 82500, quantity: 2, created: '2097-12-31 23:59:59' });
  await insert({ total: 150000, fee: 20000, quantity: 3, paid: '2098-02-10 13:00:00', status: 'delivered' });
  await insert({ total: 999999, fee: 0, payment: 'unpaid', paid: null, quantity: 99 });
  await insert({ total: 999999, fee: 0, status: 'cancelled', quantity: 99 });
  await insert({ total: 999999, fee: 0, payment: 'refund_required', quantity: 99 });
  await insert({ total: 999999, fee: 0, ghn: 'returned', quantity: 99 });
  await insert({ total: 100000, fee: 20000, paid: null, created: '2098-01-08 12:00:00' });
  await insert({ total: 10000, fee: 20000 });
  const data = await getDashboard(range);
  assert.equal(data.summary.orders, 4);
  assert.equal(data.summary.units, 7);
  assert.equal(data.summary.gross_revenue, 355500);
  assert.equal(data.summary.shipping_fee, 142500);
  assert.equal(data.summary.net_revenue, 213000);
  assert.equal(data.summary.legacy_paid_orders, 1);
  assert.equal(data.series.length, 3);
  assert.equal(data.series[0].orders, 3);
  assert.equal(data.series[1].orders, 1);
  assert.equal(data.series[2].orders, 0);
  assert.equal(data.top_products[0].units, 7);
  assert.equal(data.recent_payments.length, 4);
  assert.equal(data.order_statuses.reduce((sum, row) => sum + row.count, 0), 7);
  assert.equal(data.lifetime.orders - baseline.lifetime.orders, 4);
  assert.ok(Math.abs(data.lifetime.net_revenue - baseline.lifetime.net_revenue - 213000) < .01);
  assert.deepEqual(data.inventory, baseline.inventory);
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const token = id => jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '5m', issuer: 'book-backend', audience: 'book-app' });
  const get = (id, query = 'period=month&from=2098-01-01&to=2098-03-31') => fetch(baseUrl + '/api/admin/dashboard?' + query, { headers: id ? { Authorization: 'Bearer ' + token(id) } : {} });
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(customer.id)).status, 403);
  const result = await get(admin.id);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).data.summary.net_revenue, 213000);
  assert.equal((await get(admin.id, 'period=bad')).status, 400);
});
