import { pool } from '../config/db.js';
import { fail } from '../validation.js';

const TYPES = new Set(['percent', 'fixed']);
const SCOPES = new Set(['all', 'books', 'categories', 'authors', 'publishers']);
const scopeTables = {
  books: ['coupon_books', 'book_id', 'books'],
  categories: ['coupon_categories', 'category_id', 'categories'],
  authors: ['coupon_authors', 'author_id', 'authors'],
  publishers: ['coupon_publishers', 'publisher_id', 'publisher'],
};

function validPeriod(input) {
  if (!input.start_at || !input.end_at || !Number.isFinite(Date.parse(input.start_at)) || !Number.isFinite(Date.parse(input.end_at)) || Date.parse(input.start_at) >= Date.parse(input.end_at)) {
    fail('start_at and end_at must be valid dates, with start_at before end_at');
  }
}

function validateDiscount(input) {
  if (!TYPES.has(input.discount_type)) fail('discount_type must be percent or fixed');
  const value = Number(input.discount_value);
  if (!Number.isFinite(value) || value <= 0 || (input.discount_type === 'percent' && (value > 100 || !Number.isSafeInteger(value * 100)))) {
    fail('discount_value is outside the allowed range');
  }
  if (input.discount_type === 'fixed' && (!Number.isSafeInteger(value) || value > 1_000_000_000_000)) {
    fail('fixed discount_value must be a whole VND amount');
  }
  return value;
}

function validateIds(values, field) {
  if (!Array.isArray(values) || !values.length || values.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1)) {
    fail(`${field} must be a non-empty array of positive IDs`);
  }
  return [...new Set(values.map(Number))];
}

function validateActive(value = true) {
  if (![true, false, 0, 1].includes(value)) fail('is_active must be a boolean');
  return Number(value);
}

export async function listProductPromotions(db = pool) {
  const [programs] = await db.execute(
    `SELECT id, name, discount_type, discount_value, start_at, end_at, is_active, created_at,
            scope_type, scope_ids
     FROM product_promotions ORDER BY id DESC`,
  );
  if (!programs.length) return [];
  const [books] = await db.execute(
    `SELECT ppb.product_promotion_id, ppb.book_id, ppb.quantity_limit, ppb.quantity_used, b.title
     FROM product_promotion_books ppb JOIN books b ON b.id = ppb.book_id
     WHERE ppb.is_active = 1 AND ppb.product_promotion_id IN (${programs.map(() => '?').join(',')})
     ORDER BY b.title, b.id`, programs.map((row) => row.id),
  );
  return programs.map((program) => ({
    ...program,
    discount_value: Number(program.discount_value),
    target_ids: (typeof program.scope_ids === 'string' ? JSON.parse(program.scope_ids) : program.scope_ids)
      || books.filter((book) => book.product_promotion_id === program.id).map((book) => book.book_id),
    books: books.filter((book) => book.product_promotion_id === program.id),
  }));
}

async function resolveBooksForScope(db, scopeType, targetIds) {
  const marks = targetIds.map(() => '?').join(',');
  const queries = {
    books: [`SELECT id FROM books WHERE id IN (${marks})`, targetIds],
    categories: [`SELECT id FROM books WHERE category_id IN (${marks})`, targetIds],
    authors: [`SELECT DISTINCT b.id FROM books b JOIN book_authors ba ON ba.book_id = b.id WHERE ba.author_id IN (${marks})`, targetIds],
    publishers: [`SELECT DISTINCT b.id FROM books b JOIN book_publisher bp ON bp.book_id = b.id WHERE bp.publisher_id IN (${marks})`, targetIds],
  };
  const [rows] = await db.execute(queries[scopeType][0], queries[scopeType][1]);
  return rows.map((row) => row.id);
}

export async function saveProductPromotion(input, id = null) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 255) fail('name is required and must be at most 255 characters');
  const discountValue = validateDiscount(input);
  validPeriod(input);
  const scopeType = input.scope_type ?? 'books';
  if (!SCOPES.has(scopeType) || scopeType === 'all') fail('scope_type must be books, categories, authors or publishers');
  const targets = validateIds(input.target_ids ?? input.book_ids, 'target_ids');
  const quantityLimit = input.quantity_limit === '' || input.quantity_limit === undefined || input.quantity_limit === null
    ? null : Number(input.quantity_limit);
  if (quantityLimit !== null && (!Number.isSafeInteger(quantityLimit) || quantityLimit < 1)) fail('quantity_limit must be a positive integer');
  const active = validateActive(input.is_active ?? true);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const table = scopeTables[scopeType][2];
    for (const targetId of targets) {
      const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`, [targetId]);
      if (!rows.length) fail(`${table.toUpperCase()}_NOT_FOUND:${targetId}`, 404);
    }
    const bookIds = await resolveBooksForScope(connection, scopeType, targets);
    if (!bookIds.length) fail('PROMOTION_SCOPE_HAS_NO_BOOKS');
    let programId = id;
    if (id) {
      const [existingProgram] = await connection.execute('SELECT id FROM product_promotions WHERE id = ? FOR UPDATE', [id]);
      if (!existingProgram.length) fail('PRODUCT_PROMOTION_NOT_FOUND', 404);
      const [existingRows] = await connection.execute(
        `SELECT ppb.book_id, ppb.quantity_used FROM product_promotion_books ppb
         WHERE ppb.product_promotion_id = ? FOR UPDATE`,
        [id],
      );
      if (quantityLimit !== null && existingRows.some((row) => bookIds.includes(Number(row.book_id)) && quantityLimit < row.quantity_used)) {
        fail('quantity_limit cannot be lower than the number already reserved');
      }
      await connection.execute(
        `UPDATE product_promotions SET name = ?, discount_type = ?, discount_value = ?,
         start_at = ?, end_at = ?, is_active = ?, scope_type = ?, scope_ids = ? WHERE id = ?`,
        [name, input.discount_type, discountValue, input.start_at, input.end_at, active, scopeType, JSON.stringify(targets), id],
      );
      await connection.execute('UPDATE product_promotion_books SET is_active = 0 WHERE product_promotion_id = ?', [id]);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO product_promotions (name, discount_type, discount_value, start_at, end_at, is_active, scope_type, scope_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, input.discount_type, discountValue, input.start_at, input.end_at, active, scopeType, JSON.stringify(targets)],
      );
      programId = result.insertId;
    }
    for (const bookId of bookIds) {
      await connection.execute(
        `INSERT INTO product_promotion_books (product_promotion_id, book_id, quantity_limit, quantity_used, is_active)
         VALUES (?, ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE quantity_limit = VALUES(quantity_limit), is_active = 1`,
        [programId, bookId, quantityLimit],
      );
    }
    await connection.commit();
    return programId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listCoupons(db = pool) {
  const [rows] = await db.execute(
    `SELECT p.*, (p.start_at <= UTC_TIMESTAMP() AND p.end_at > UTC_TIMESTAMP()) AS currently_valid
     FROM promotions p WHERE p.kind = 'order' ORDER BY p.id DESC`,
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [bookRows] = await db.execute(`SELECT promotion_id, book_id FROM coupon_books WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids);
  const [categoryRows] = await db.execute(`SELECT promotion_id, category_id FROM coupon_categories WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids);
  const [authorRows] = await db.execute(`SELECT promotion_id, author_id FROM coupon_authors WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids);
  const [publisherRows] = await db.execute(`SELECT promotion_id, publisher_id FROM coupon_publishers WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids);
  return rows.map((row) => ({
    ...row,
    discount_value: Number(row.discount_value),
    min_order_amount: Number(row.min_order_amount),
    max_discount_amount: row.max_discount_amount === null ? null : Number(row.max_discount_amount),
    book_ids: bookRows.filter((item) => item.promotion_id === row.id).map((item) => item.book_id),
    category_ids: categoryRows.filter((item) => item.promotion_id === row.id).map((item) => item.category_id),
    author_ids: authorRows.filter((item) => item.promotion_id === row.id).map((item) => item.author_id),
    publisher_ids: publisherRows.filter((item) => item.promotion_id === row.id).map((item) => item.publisher_id),
  }));
}

export async function saveCoupon(input, id = null) {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!/^[A-Z0-9_-]{3,50}$/.test(code)) fail('code must contain 3 to 50 letters, numbers, _ or -');
  if (!name || name.length > 255) fail('name is required and must be at most 255 characters');
  const discountValue = validateDiscount(input);
  validPeriod(input);
  const minOrder = Number(input.min_order_amount ?? 0);
  const maxDiscount = input.max_discount_amount === '' || input.max_discount_amount === undefined || input.max_discount_amount === null
    ? null : Number(input.max_discount_amount);
  const totalLimit = input.total_usage_limit === '' || input.total_usage_limit === undefined || input.total_usage_limit === null
    ? null : Number(input.total_usage_limit);
  const perCustomerLimit = input.per_customer_limit === '' || input.per_customer_limit === undefined || input.per_customer_limit === null
    ? null : Number(input.per_customer_limit);
  if (!Number.isSafeInteger(minOrder) || minOrder < 0 || (maxDiscount !== null && (!Number.isSafeInteger(maxDiscount) || maxDiscount < 0))) fail('Coupon amounts must be non-negative whole VND amounts');
  for (const limit of [totalLimit, perCustomerLimit]) if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) fail('Usage limits must be positive integers');
  const scopeType = input.scope_type ?? 'all';
  if (!SCOPES.has(scopeType)) fail('scope_type must be all, books, categories, authors or publishers');
  const targets = scopeType === 'all' ? [] : validateIds(input.target_ids ?? input[scopeTables[scopeType][1].replace(/_id$/, '_ids')], 'target_ids');
  const active = validateActive(input.is_active ?? true);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (scopeType !== 'all') {
      const table = scopeTables[scopeType][2];
      for (const targetId of targets) {
        const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`, [targetId]);
        if (!rows.length) fail(`${table.toUpperCase()}_NOT_FOUND:${targetId}`, 404);
      }
    }
    let promotionId = id;
    const values = [name, code, input.discount_type, discountValue, minOrder, maxDiscount, input.start_at, input.end_at, active, totalLimit, perCustomerLimit, scopeType];
    if (id) {
      const [existingPromotion] = await connection.execute("SELECT id FROM promotions WHERE id = ? AND kind = 'order' FOR UPDATE", [id]);
      if (!existingPromotion.length) fail('PROMOTION_NOT_FOUND', 404);
      await connection.execute(
        `UPDATE promotions SET name=?, code=?, discount_type=?, discount_value=?, min_order_amount=?, max_discount_amount=?,
         start_at=?, end_at=?, is_active=?, total_usage_limit=?, per_customer_limit=?, scope_type=?
         WHERE id=? AND kind='order'`, [...values, id],
      );
      await connection.execute('UPDATE coupon_books SET is_active = 0 WHERE promotion_id = ?', [id]);
      await connection.execute('UPDATE coupon_categories SET is_active = 0 WHERE promotion_id = ?', [id]);
      await connection.execute('UPDATE coupon_authors SET is_active = 0 WHERE promotion_id = ?', [id]);
      await connection.execute('UPDATE coupon_publishers SET is_active = 0 WHERE promotion_id = ?', [id]);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO promotions (name, code, kind, discount_type, discount_value, min_order_amount, max_discount_amount,
         start_at, end_at, is_active, total_usage_limit, usage_count, per_customer_limit, scope_type)
         VALUES (?, ?, 'order', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [name, code, input.discount_type, discountValue, minOrder, maxDiscount, input.start_at, input.end_at, active, totalLimit, perCustomerLimit, scopeType],
      );
      promotionId = result.insertId;
    }
    for (const targetId of targets) {
      const [table, column] = scopeTables[scopeType];
      await connection.execute(
        `INSERT INTO ${table} (promotion_id, ${column}, is_active) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE is_active = 1`, [promotionId, targetId],
      );
    }
    await connection.commit();
    return promotionId;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('PROMOTION_CODE_ALREADY_EXISTS', 409);
    throw error;
  } finally {
    connection.release();
  }
}
