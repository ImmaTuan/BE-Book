import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/db.js';
try {
  const sql = await readFile(new URL('../database/add_vnpay.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('VNPAY payment table is ready');
} finally { await pool.end(); }
