import { pool } from './config/db.js';
import { fail } from './validation.js';

const toMinor = (value) => Math.round((Number(value) || 0) * 100);
const fromMinor = (value) => Math.max(0, value) / 100;
const roundMoney = (value) => fromMinor(toMinor(value));

function productDiscount(price, type, value) {
  const base = toMinor(price);
  const raw = type === 'percent' ? Math.round(base * Number(value) / 100) : toMinor(value);
  return fromMinor(Math.min(base, raw));
}

export async function priceBooks(bookRows, quantities, db = pool, { lock = false } = {}) {
  if (!bookRows.length) return [];
  const ids = bookRows.map((book) => book.id);
  const [promotions] = await db.execute(
    `SELECT ppb.book_id, ppb.product_promotion_id, ppb.quantity_limit, ppb.quantity_used,
            pp.name, pp.discount_type, pp.discount_value, pp.start_at, pp.end_at
     FROM product_promotion_books ppb
     JOIN product_promotions pp ON pp.id = ppb.product_promotion_id
     WHERE ppb.is_active = 1 AND ppb.book_id IN (${ids.map(() => '?').join(',')})
       AND pp.is_active = 1 AND pp.start_at <= UTC_TIMESTAMP() AND pp.end_at > UTC_TIMESTAMP()
       AND (ppb.quantity_limit IS NULL OR ppb.quantity_used < ppb.quantity_limit)
     ORDER BY ppb.book_id, pp.id${lock ? ' FOR UPDATE' : ''}`,
    ids,
  );
  return bookRows.map((book) => {
    const price = roundMoney(book.price);
    const quantity = quantities.get(book.id) ?? 1;
    const candidates = promotions.filter((row) => row.book_id === book.id)
      .filter((row) => row.quantity_limit === null || row.quantity_limit - row.quantity_used >= quantity)
      .map((row) => ({ ...row, amount: productDiscount(price, row.discount_type, row.discount_value) }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.product_promotion_id - b.product_promotion_id);
    const chosen = candidates[0];
    return {
      ...book,
      original_unit_price: price,
      unit_price: price - (chosen?.amount ?? 0),
      direct_discount_amount: chosen?.amount ?? 0,
      product_promotion_id: chosen?.product_promotion_id ?? null,
      product_promotion: chosen ? {
        id: chosen.product_promotion_id,
        name: chosen.name,
        discount_type: chosen.discount_type,
        discount_value: Number(chosen.discount_value),
        percent_off: Math.round(chosen.amount / price * 100),
        start_at: chosen.start_at,
        end_at: chosen.end_at,
      } : null,
      flash_sale_quantity: !chosen || chosen.quantity_limit === null
        ? null
        : Math.max(0, Number(chosen.quantity_limit - chosen.quantity_used)),
    };
  });
}

export async function decorateBookPromotions(books, db = pool) {
  const priced = await priceBooks(books, new Map(), db);
  return priced;
}

function couponStatus(promotion, usageByUser) {
  if (!promotion.is_active) return 'INACTIVE';
  if (!promotion.is_current) return promotion.has_started ? 'EXPIRED' : 'NOT_STARTED';
  if (promotion.total_usage_limit !== null && promotion.usage_count >= promotion.total_usage_limit) return 'USAGE_LIMIT_REACHED';
  if (promotion.per_customer_limit !== null && (usageByUser.get(promotion.id) ?? 0) >= promotion.per_customer_limit) return 'CUSTOMER_LIMIT_REACHED';
  return null;
}

async function couponScopes(promotions, db, items) {
  const ids = promotions.filter((promotion) => promotion.scope_type !== 'all').map((promotion) => promotion.id);
  if (!ids.length) return { books: new Map(), categories: new Map(), authors: new Map(), publishers: new Map(), bookAuthors: new Map(), bookPublishers: new Map() };
  const [bookScopes] = await db.execute(
    `SELECT promotion_id, book_id FROM coupon_books WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids,
  );
  const [categoryScopes] = await db.execute(
    `SELECT promotion_id, category_id FROM coupon_categories WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids,
  );
  const [authorScopes] = await db.execute(
    `SELECT promotion_id, author_id FROM coupon_authors WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids,
  );
  const [publisherScopes] = await db.execute(
    `SELECT promotion_id, publisher_id FROM coupon_publishers WHERE is_active = 1 AND promotion_id IN (${ids.map(() => '?').join(',')})`, ids,
  );
  const bookIds = [...new Set(items.map((item) => item.book_id))];
  const [bookAuthors] = await db.execute(`SELECT book_id, author_id FROM book_authors WHERE book_id IN (${bookIds.map(() => '?').join(',')})`, bookIds);
  const [bookPublishers] = await db.execute(`SELECT book_id, publisher_id FROM book_publisher WHERE book_id IN (${bookIds.map(() => '?').join(',')})`, bookIds);
  const books = new Map();
  for (const row of bookScopes) {
    const list = books.get(row.promotion_id) ?? new Set(); list.add(row.book_id); books.set(row.promotion_id, list);
  }
  const categories = new Map();
  for (const row of categoryScopes) {
    const list = categories.get(row.promotion_id) ?? new Set(); list.add(row.category_id); categories.set(row.promotion_id, list);
  }
  const authors = new Map();
  for (const row of authorScopes) {
    const list = authors.get(row.promotion_id) ?? new Set(); list.add(row.author_id); authors.set(row.promotion_id, list);
  }
  const publishers = new Map();
  for (const row of publisherScopes) {
    const list = publishers.get(row.promotion_id) ?? new Set(); list.add(row.publisher_id); publishers.set(row.promotion_id, list);
  }
  const mapRelations = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.book_id) ?? new Set(); list.add(row[key]); map.set(row.book_id, list);
    }
    return map;
  };
  return { books, categories, authors, publishers, bookAuthors: mapRelations(bookAuthors, 'author_id'), bookPublishers: mapRelations(bookPublishers, 'publisher_id') };
}

function eligibleItems(promotion, items, scopes) {
  if (promotion.scope_type === 'all') return items;
  if (promotion.scope_type === 'books') {
    const allowed = scopes.books.get(promotion.id) ?? new Set();
    return items.filter((item) => allowed.has(item.book_id));
  }
  if (promotion.scope_type === 'categories') {
    const allowed = scopes.categories.get(promotion.id) ?? new Set();
    return items.filter((item) => allowed.has(item.category_id));
  }
  if (promotion.scope_type === 'authors') {
    const allowed = scopes.authors.get(promotion.id) ?? new Set();
    return items.filter((item) => [...(scopes.bookAuthors.get(item.book_id) ?? [])].some((id) => allowed.has(id)));
  }
  const allowed = scopes.publishers.get(promotion.id) ?? new Set();
  return items.filter((item) => [...(scopes.bookPublishers.get(item.book_id) ?? [])].some((id) => allowed.has(id)));
}

function couponAmount(promotion, base) {
  const baseMinor = toMinor(base);
  const amount = promotion.discount_type === 'percent'
    ? Math.round(baseMinor * Number(promotion.discount_value) / 100)
    : toMinor(promotion.discount_value);
  const capped = promotion.max_discount_amount === null
    ? amount
    : Math.min(amount, toMinor(promotion.max_discount_amount));
  return fromMinor(Math.min(baseMinor, capped));
}

export async function calculateOrderQuote({ items, userId, orderCode = null, db = pool, lock = false, strictPromotion = false }) {
  if (!Array.isArray(items) || !items.length || items.length > 50) fail('items must contain 1 to 50 books');
  const quantities = new Map();
  for (const item of items) {
    if (!Number.isInteger(item.book_id) || item.book_id < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      fail('Each item requires a valid book_id and quantity from 1 to 99');
    }
    if (quantities.has(item.book_id)) fail('Duplicate book_id is not allowed');
    quantities.set(item.book_id, item.quantity);
  }
  const sortedItems = [...items].sort((a, b) => a.book_id - b.book_id);
  const [books] = await db.execute(
    `SELECT id, category_id, title, price, stock_quantity, is_active, weight_grams
     FROM books WHERE id IN (${sortedItems.map(() => '?').join(',')}) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    sortedItems.map((item) => item.book_id),
  );
  if (books.length !== items.length) fail('BOOK_UNAVAILABLE');
  for (const book of books) {
    if (!book.is_active) fail('BOOK_UNAVAILABLE');
    if (book.stock_quantity < quantities.get(book.id)) fail(`BOOK_STOCK_INSUFFICIENT:${book.id}`, 409);
  }
  const pricedBooks = await priceBooks(books, quantities, db, { lock });
  const byId = new Map(pricedBooks.map((book) => [book.id, book]));
  const lines = sortedItems.map(({ book_id, quantity }) => {
    const book = byId.get(book_id);
    return {
      book_id,
      book_title: book.title,
      category_id: book.category_id,
      quantity,
      original_unit_price: book.original_unit_price,
      unit_price: book.unit_price,
      direct_discount_amount: book.direct_discount_amount * quantity,
      product_promotion_id: book.product_promotion_id,
      product_promotion: book.product_promotion,
      line_subtotal: roundMoney(book.unit_price * quantity),
      flash_sale_quantity: book.flash_sale_quantity,
      weight_grams: book.weight_grams,
    };
  });
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.line_subtotal, 0));
  const directDiscountAmount = roundMoney(lines.reduce((sum, line) => sum + line.direct_discount_amount, 0));
  if (!Number.isSafeInteger(toMinor(subtotal))) fail('ORDER_TOTAL_TOO_LARGE', 400);
  const [promotions] = await db.execute(
    `SELECT p.*, (p.start_at <= UTC_TIMESTAMP() AND p.end_at > UTC_TIMESTAMP()) AS is_current,
            (p.start_at <= UTC_TIMESTAMP()) AS has_started
     FROM promotions p WHERE p.kind = 'order'${lock ? ' FOR UPDATE' : ''}`,
  );
  let usageByUser = new Map();
  if (userId && promotions.length) {
    const [usageRows] = await db.execute(
      `SELECT promotion_id, COUNT(*) AS used_count FROM promotion_usages
       WHERE user_id = ? AND status IN ('reserved','used')
       GROUP BY promotion_id`, [userId],
    );
    usageByUser = new Map(usageRows.map((row) => [row.promotion_id, Number(row.used_count)]));
  }
  const scopes = await couponScopes(promotions, db, lines);
  const coupons = promotions.map((promotion) => {
    const status = couponStatus(promotion, usageByUser);
    const scoped = eligibleItems(promotion, lines, scopes);
    const eligibleSubtotal = scoped.reduce((sum, line) => sum + line.line_subtotal, 0);
    const belowMinimum = subtotal < roundMoney(promotion.min_order_amount);
    const noApplicableItems = !scoped.length;
    const reason = status ?? (belowMinimum ? 'MINIMUM_NOT_MET' : noApplicableItems ? 'NO_APPLICABLE_ITEMS' : null);
    return {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      discount_type: promotion.discount_type,
      discount_value: Number(promotion.discount_value),
      max_discount_amount: promotion.max_discount_amount === null ? null : Number(promotion.max_discount_amount),
      min_order_amount: Number(promotion.min_order_amount),
      end_at: promotion.end_at,
      eligible: !reason,
      reason,
      missing_amount: belowMinimum ? roundMoney(promotion.min_order_amount) - subtotal : 0,
      estimated_discount_amount: reason ? 0 : couponAmount(promotion, eligibleSubtotal),
    };
  });
  const chosenCode = orderCode ? String(orderCode).trim().toUpperCase() : null;
  let promotionError = null;
  let selectedCoupon = null;
  let selectedEligibleLines = [];
  if (chosenCode) {
    selectedCoupon = coupons.find((coupon) => coupon.code.toUpperCase() === chosenCode);
    if (!selectedCoupon) {
      promotionError = { code: 'PROMOTION_NOT_FOUND', missing_amount: 0 };
      if (strictPromotion) fail('PROMOTION_NOT_FOUND', 422);
    } else if (!selectedCoupon.eligible) {
      promotionError = { code: selectedCoupon.reason, missing_amount: selectedCoupon.missing_amount };
      if (strictPromotion) fail(selectedCoupon.reason, 422);
      selectedCoupon = null;
    } else {
      const promotion = promotions.find((row) => row.id === selectedCoupon.id);
      selectedEligibleLines = eligibleItems(promotion, lines, scopes);
    }
  }
  const orderDiscountAmount = selectedCoupon?.estimated_discount_amount ?? 0;
  for (const line of lines) line.order_discount_amount = 0;
  if (orderDiscountAmount > 0 && selectedEligibleLines.length) {
    let remaining = orderDiscountAmount;
    const eligibleBase = selectedEligibleLines.reduce((sum, line) => sum + line.line_subtotal, 0);
    selectedEligibleLines.forEach((line, index) => {
      const allocatedMinor = index === selectedEligibleLines.length - 1
        ? toMinor(remaining)
        : Math.min(toMinor(remaining), Math.floor(toMinor(orderDiscountAmount) * toMinor(line.line_subtotal) / toMinor(eligibleBase)));
      const allocated = fromMinor(allocatedMinor);
      line.order_discount_amount = allocated;
      remaining -= allocated;
    });
  }
  return {
    items: lines,
    subtotal,
    direct_discount_amount: directDiscountAmount,
    order_discount_amount: orderDiscountAmount,
    total_amount: Math.max(0, subtotal - orderDiscountAmount),
    selected_order_promotion: selectedCoupon,
    promotion_error: promotionError,
    order_promotions: coupons,
  };
}
