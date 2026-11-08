import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/db.js';

try {
  const [columns] = await pool.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'",
  );
  if (!columns.length) throw new Error('orders table does not exist; run database/add_orders.sql first');
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const source = await readFile(new URL('../database/add_order_payment.sql', import.meta.url), 'utf8');
  for (const statement of source.replace(/^--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) {
    const column = statement.match(/ADD COLUMN `([a-z_]+)`/)?.[1];
    if (!column) throw new Error('Unexpected order payment migration statement');
    if (existing.has(column)) continue;
    await pool.query(statement);
    console.log('Added orders.' + column);
  }
  // Legacy orders were all COD. We know their outcome, but not the actual paid
  // timestamp, so paid_at remains NULL rather than inventing a payment date.
  if (!existing.has('payment_status')) {
    await pool.execute(
      "UPDATE orders SET payment_status = CASE WHEN status = 'delivered' OR ghn_status = 'delivered' THEN 'paid' WHEN status = 'cancelled' OR ghn_status IN ('cancel', 'returned') THEN 'cancelled' ELSE 'unpaid' END WHERE payment_method = 'cod' AND payment_status = 'unpaid'",
    );
  }
  console.log('Order payment schema is ready');
} finally {
  await pool.end();
}
