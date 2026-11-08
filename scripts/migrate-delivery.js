import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/db.js';

try {
  const [columns] = await pool.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'",
  );
  if (!columns.length) throw new Error('orders table does not exist; run database/add_orders.sql first');
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));
  const source = await readFile(new URL('../database/add_delivery_estimate.sql', import.meta.url), 'utf8');
  for (const statement of source.replace(/^--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) {
    const column = statement.match(/ADD COLUMN `([a-z_]+)`/)?.[1];
    if (!column) throw new Error('Unexpected delivery migration statement');
    if (existing.has(column)) continue;
    await pool.query(statement);
    console.log('Added orders.' + column);
  }
  console.log('Delivery estimate schema is ready');
} finally {
  await pool.end();
}
