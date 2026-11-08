import { pool } from '../config/db.js';
import { dashboardSeries } from '../dashboard-periods.js';

const paidOrders = "o.payment_status = 'paid' AND o.status <> 'cancelled' AND COALESCE(o.ghn_status, '') NOT IN ('cancel', 'returned')";
const paidDate = 'COALESCE(o.paid_at, o.created_at)';
const normalize = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));

export async function getDashboard(range) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[inventory]] = await db.execute(
      `SELECT COUNT(*) AS total_products,
        COALESCE(SUM(is_active = 1), 0) AS active_products,
        COALESCE(SUM(is_active = 0), 0) AS hidden_products,
        COALESCE(SUM(stock_quantity), 0) AS stock_units,
        COALESCE(SUM(is_active = 1 AND stock_quantity = 0), 0) AS out_of_stock,
        COALESCE(SUM(is_active = 1 AND stock_quantity BETWEEN 1 AND 5), 0) AS low_stock,
        COALESCE(ROUND(SUM(price * stock_quantity), 2), 0) AS inventory_value
       FROM books`,
    );
    const [daily] = await db.execute(
      `SELECT DATE_FORMAT(${paidDate}, '%Y-%m-%d') AS day, COUNT(*) AS orders,
        COALESCE(SUM(q.units), 0) AS units,
        COALESCE(ROUND(SUM(o.total_amount), 2), 0) AS gross_revenue,
        COALESCE(ROUND(SUM(o.shipping_fee), 2), 0) AS shipping_fee,
        COALESCE(ROUND(SUM(o.total_amount - o.shipping_fee), 2), 0) AS net_revenue,
        SUM(o.paid_at IS NULL) AS legacy_paid_orders
       FROM orders o
       LEFT JOIN (SELECT order_id, SUM(quantity) AS units FROM order_items GROUP BY order_id) q ON q.order_id = o.id
       WHERE ${paidOrders} AND ${paidDate} >= ? AND ${paidDate} < ?
       GROUP BY day ORDER BY day`,
      [range.from, range.toExclusive],
    );
    const [[lifetime]] = await db.execute(
      `SELECT COUNT(*) AS orders,
        COALESCE(ROUND(SUM(o.total_amount), 2), 0) AS gross_revenue,
        COALESCE(ROUND(SUM(o.shipping_fee), 2), 0) AS shipping_fee,
        COALESCE(ROUND(SUM(o.total_amount - o.shipping_fee), 2), 0) AS net_revenue,
        COALESCE(SUM(o.paid_at IS NULL), 0) AS legacy_paid_orders
       FROM orders o WHERE ${paidOrders}`,
    );
    const [statuses] = await db.execute(
      'SELECT status, COUNT(*) AS count FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status',
      [range.from, range.toExclusive],
    );
    const [topProducts] = await db.execute(
      `SELECT oi.book_id, MAX(oi.book_title) AS title, SUM(oi.quantity) AS units, COUNT(DISTINCT o.id) AS orders
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE ${paidOrders} AND ${paidDate} >= ? AND ${paidDate} < ?
       GROUP BY oi.book_id ORDER BY units DESC, oi.book_id LIMIT 5`,
      [range.from, range.toExclusive],
    );
    const [recentPayments] = await db.execute(
      `SELECT o.id, o.order_code, o.payment_method, o.status, o.total_amount, o.shipping_fee,
         DATE_FORMAT(${paidDate}, '%Y-%m-%d %H:%i:%s') AS paid_date
       FROM orders o WHERE ${paidOrders} AND ${paidDate} >= ? AND ${paidDate} < ?
       ORDER BY ${paidDate} DESC, o.id DESC LIMIT 5`,
      [range.from, range.toExclusive],
    );
    await db.commit();
    const series = dashboardSeries(daily, range);
    const summary = normalize({ orders: 0, units: 0, gross_revenue: 0, shipping_fee: 0, net_revenue: 0, legacy_paid_orders: 0 });
    for (const row of series) for (const key of Object.keys(summary)) summary[key] += row[key];
    for (const key of Object.keys(summary)) summary[key] = Math.round(summary[key] * 100) / 100;
    return {
      range: { period: range.period, from: range.from, to: range.to },
      inventory: normalize(inventory), summary, lifetime: normalize(lifetime), series,
      order_statuses: statuses.map(row => ({ status: row.status, count: Number(row.count) })),
      top_products: topProducts.map(row => ({ ...row, units: Number(row.units), orders: Number(row.orders) })),
      recent_payments: recentPayments.map(row => ({ ...row, total_amount: Number(row.total_amount), shipping_fee: Number(row.shipping_fee), paid_at: row.paid_date.replace(' ', 'T') + '+07:00' })),
      generated_at: new Date().toISOString(),
    };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}
