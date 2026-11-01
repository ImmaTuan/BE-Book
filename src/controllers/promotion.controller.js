import * as promotions from '../models/promotion.model.js';
import { pool } from '../config/db.js';
import { fail, id } from '../validation.js';

export async function listProductPromotions(req, res) {
  res.json({ data: await promotions.listProductPromotions() });
}

export async function createProductPromotion(req, res) {
  const programId = await promotions.saveProductPromotion(req.body);
  res.status(201).json({ message: 'Product promotion created', data: { id: programId } });
}

export async function updateProductPromotion(req, res) {
  const programId = id(req.params.id);
  await promotions.saveProductPromotion(req.body, programId);
  res.json({ message: 'Product promotion updated', data: { id: programId } });
}

export async function listCoupons(req, res) {
  res.json({ data: await promotions.listCoupons() });
}

export async function createCoupon(req, res) {
  const promotionId = await promotions.saveCoupon(req.body);
  res.status(201).json({ message: 'Order coupon created', data: { id: promotionId } });
}

export async function updateCoupon(req, res) {
  const promotionId = id(req.params.id);
  await promotions.saveCoupon(req.body, promotionId);
  res.json({ message: 'Order coupon updated', data: { id: promotionId } });
}

export async function bookSuggestions(req, res) {
  const bookId = id(req.params.id);
  const [books] = await pool.execute(
    'SELECT id, category_id, price FROM books WHERE id = ? AND is_active = 1', [bookId],
  );
  if (!books.length) fail('BOOK_NOT_FOUND', 404);
  const book = books[0];
  const [rows] = await pool.execute(
    `SELECT p.id, p.code, p.name, p.discount_type, p.discount_value, p.min_order_amount,
            p.max_discount_amount, p.start_at, p.end_at, p.scope_type
     FROM promotions p
     WHERE p.kind = 'order' AND p.is_active = 1
       AND p.start_at <= UTC_TIMESTAMP() AND p.end_at > UTC_TIMESTAMP()
       AND (p.total_usage_limit IS NULL OR p.usage_count < p.total_usage_limit)
       AND (
         p.scope_type = 'all' OR
         (p.scope_type = 'books' AND EXISTS (
           SELECT 1 FROM coupon_books cb WHERE cb.promotion_id = p.id AND cb.book_id = ? AND cb.is_active = 1
         )) OR
         (p.scope_type = 'categories' AND EXISTS (
           SELECT 1 FROM coupon_categories cc WHERE cc.promotion_id = p.id AND cc.category_id = ? AND cc.is_active = 1
         ))
       ) ORDER BY p.end_at ASC`, [bookId, book.category_id],
  );
  res.json({ data: rows.map((row) => ({
    ...row,
    discount_value: Number(row.discount_value),
    min_order_amount: Number(row.min_order_amount),
    max_discount_amount: row.max_discount_amount === null ? null : Number(row.max_discount_amount),
    applicability: 'possible',
    requires_cart_check: true,
  })) });
}
