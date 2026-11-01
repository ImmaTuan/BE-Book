import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderQuote } from '../src/promotion-pricing.js';

function mockDb({
  books = [{ id: 1, category_id: 10, title: 'Book', price: 128000, stock_quantity: 20, is_active: 1, weight_grams: 300 }],
  productPromotions = [], coupons = [], couponBooks = [], couponCategories = [], usageRows = [],
} = {}) {
  return {
    async execute(sql, args = []) {
      if (sql.includes('FROM books WHERE id IN')) return [books.filter((book) => args.includes(book.id)), []];
      if (sql.includes('FROM product_promotion_books ppb')) return [productPromotions.filter((row) => args.includes(row.book_id)), []];
      if (sql.includes('SELECT p.*')) return [coupons, []];
      if (sql.includes('COUNT(*) AS used_count')) return [usageRows, []];
      if (sql.includes('FROM coupon_books')) return [couponBooks.filter((row) => args.includes(row.promotion_id)), []];
      if (sql.includes('FROM coupon_categories')) return [couponCategories.filter((row) => args.includes(row.promotion_id)), []];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const bookItem = [{ book_id: 1, quantity: 2 }];

test('direct promotion chooses the greatest actual saving and snapshots sale price', async () => {
  const db = mockDb({ productPromotions: [
    { book_id: 1, product_promotion_id: 1, quantity_limit: null, quantity_used: 0, name: '33% off', discount_type: 'percent', discount_value: 33 },
    { book_id: 1, product_promotion_id: 2, quantity_limit: null, quantity_used: 0, name: 'Fixed discount', discount_type: 'fixed', discount_value: 40000 },
  ] });
  const quote = await calculateOrderQuote({ items: bookItem, userId: 7, db });
  assert.equal(quote.items[0].unit_price, 85760);
  assert.equal(quote.items[0].product_promotion.name, '33% off');
  assert.equal(quote.direct_discount_amount, 84480);
  assert.equal(quote.subtotal, 171520);
});

test('a flash sale without enough remaining quantity is skipped', async () => {
  const db = mockDb({ productPromotions: [
    { book_id: 1, product_promotion_id: 1, quantity_limit: 3, quantity_used: 2, name: 'Limited sale', discount_type: 'fixed', discount_value: 50000 },
    { book_id: 1, product_promotion_id: 2, quantity_limit: null, quantity_used: 0, name: 'Regular sale', discount_type: 'fixed', discount_value: 10000 },
  ] });
  const quote = await calculateOrderQuote({ items: bookItem, userId: 7, db });
  assert.equal(quote.items[0].product_promotion.name, 'Regular sale');
  assert.equal(quote.items[0].unit_price, 118000);
});

test('expired coupons are reported and never reduce the quote', async () => {
  const db = mockDb({ coupons: [{
    id: 3, code: 'OLD', name: 'Expired', kind: 'order', is_active: 1, is_current: 0, has_started: 1,
    total_usage_limit: null, usage_count: 0, per_customer_limit: null, scope_type: 'all',
    discount_type: 'fixed', discount_value: 10000, min_order_amount: 0, max_discount_amount: null,
  }] });
  const quote = await calculateOrderQuote({ items: bookItem, userId: 7, orderCode: 'OLD', db });
  assert.equal(quote.promotion_error.code, 'EXPIRED');
  assert.equal(quote.order_discount_amount, 0);
});

test('minimum order threshold reports the missing amount after direct discounts', async () => {
  const db = mockDb({ coupons: [{
    id: 4, code: 'MIN', name: 'Minimum', kind: 'order', is_active: 1, is_current: 1, has_started: 1,
    total_usage_limit: null, usage_count: 0, per_customer_limit: null, scope_type: 'all',
    discount_type: 'fixed', discount_value: 10000, min_order_amount: 300000, max_discount_amount: null,
  }] });
  const quote = await calculateOrderQuote({ items: bookItem, userId: 7, orderCode: 'MIN', db });
  assert.equal(quote.promotion_error.code, 'MINIMUM_NOT_MET');
  assert.equal(quote.promotion_error.missing_amount, 44000);
});

test('coupon discount is capped at eligible subtotal and cannot make total negative', async () => {
  const db = mockDb({ coupons: [{
    id: 5, code: 'BIG', name: 'Large fixed discount', kind: 'order', is_active: 1, is_current: 1, has_started: 1,
    total_usage_limit: null, usage_count: 0, per_customer_limit: null, scope_type: 'all',
    discount_type: 'fixed', discount_value: 999999, min_order_amount: 0, max_discount_amount: null,
  }] });
  const quote = await calculateOrderQuote({ items: [{ book_id: 1, quantity: 1 }], userId: 7, orderCode: 'BIG', db });
  assert.equal(quote.order_discount_amount, 128000);
  assert.equal(quote.total_amount, 0);
});

test('total-use, customer-use, and changed-cart scope failures are explicit', async () => {
  const base = {
    is_active: 1, is_current: 1, has_started: 1, scope_type: 'all', discount_type: 'fixed',
    discount_value: 1000, min_order_amount: 0, max_discount_amount: null,
  };
  const totalDb = mockDb({ coupons: [{ ...base, id: 6, code: 'LAST', name: 'Last use', total_usage_limit: 1, usage_count: 1, per_customer_limit: null }] });
  assert.equal((await calculateOrderQuote({ items: bookItem, userId: 7, orderCode: 'LAST', db: totalDb })).promotion_error.code, 'USAGE_LIMIT_REACHED');

  const customerDb = mockDb({ coupons: [{ ...base, id: 7, code: 'ONE', name: 'One per customer', total_usage_limit: null, usage_count: 0, per_customer_limit: 1 }], usageRows: [{ promotion_id: 7, used_count: 1 }] });
  assert.equal((await calculateOrderQuote({ items: bookItem, userId: 7, orderCode: 'ONE', db: customerDb })).promotion_error.code, 'CUSTOMER_LIMIT_REACHED');

  const changedCartDb = mockDb({
    books: [{ id: 2, category_id: 20, title: 'Other book', price: 50000, stock_quantity: 3, is_active: 1, weight_grams: 200 }],
    coupons: [{ ...base, id: 8, code: 'ONLY1', name: 'Book one only', scope_type: 'books', total_usage_limit: null, usage_count: 0, per_customer_limit: null }],
    couponBooks: [{ promotion_id: 8, book_id: 1 }],
  });
  assert.equal((await calculateOrderQuote({ items: [{ book_id: 2, quantity: 1 }], userId: 7, orderCode: 'ONLY1', db: changedCartDb })).promotion_error.code, 'NO_APPLICABLE_ITEMS');
});
