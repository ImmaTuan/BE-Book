# Promotions rollout and API checks

This change covers direct book discounts and order coupons. It deliberately does not add shipping coupons, calculate a shipping fee, or modify the GHN service. A new order stays `pending`; an admin uses the existing order status API/UI to confirm it manually.

## Apply the migrations

Back up the current database first. `add_promotions.sql` and `add_promotion_author_publisher_scopes.sql` currently target `cua_hang_sach2`; confirm that is the intended database before running them. `migrate_money_decimal.sql` currently targets `cua_hang_sach`, so change its `USE` line if your active database is `cua_hang_sach2`.

1. `add_promotions.sql` creates the new promotion/link/history tables, extends the existing `promotions`, `orders`, and `order_items` tables, and backfills any old `orders.promotion_id` uses.
2. `migrate_money_decimal.sql` first shows preview queries, then changes the book/order/item/coupon/payment amounts from `FLOAT` to `DECIMAL(15,2)`. It does not alter shipping or GHN amount columns.
3. `add_promotion_author_publisher_scopes.sql` adds coupon targeting by author/publisher and stores the chosen scope for direct promotions. For a direct promotion, the selected books are snapshotted when it is saved; books added later to the selected author/publisher are not automatically included.

All migrations preserve existing rows. They are one-time migrations; do not run them again after the `ALTER TABLE` statements have succeeded.
The author/publisher migration is also a one-time migration and preserves existing promotions.

## API routes

Admin routes require an admin bearer token:

- `GET/POST /api/admin/promotions/products`
- `PATCH /api/admin/promotions/products/:id`
- `GET/POST /api/admin/promotions/coupons`
- `PATCH /api/admin/promotions/coupons/:id`

Customer/public routes:

- `GET /api/books` and `GET /api/books/:id` return direct price data; `GET /api/promotions/books/:id` returns order coupons that may apply to that book.
- `POST /api/orders/quote` requires a customer token and accepts `items` plus optional `order_promotion_code`.
- `POST /api/orders` accepts the same code with the existing recipient/address fields. Prices and coupon usage are recalculated in the order transaction.

Example quote request:

```json
{
  "items": [{ "book_id": 10, "quantity": 2 }],
  "order_promotion_code": "SACH10"
}
```

The quote response includes line snapshots (`original_unit_price`, `unit_price`, direct discount), `order_promotions` with eligibility and reasons, and `subtotal`, `direct_discount_amount`, `order_discount_amount`, and `total_amount`. A quote with a selected but invalid code returns `promotion_error`, allowing the UI to explain why it cannot be used. Order creation rejects that selection.

## Postman cases

Import `../postman/Promotions.postman_collection.json`, set `baseUrl`, `adminToken`, `customerToken`, `bookId`, and `otherBookId`, then create test coupons with the indicated properties before running the matching case requests:

- Expired code: expected `promotion_error.code = EXPIRED` and a zero discount.
- Minimum not met: expected `MINIMUM_NOT_MET` and a positive `missing_amount`.
- Total limit reached: expected `USAGE_LIMIT_REACHED`.
- Per-customer limit reached: expected `CUSTOMER_LIMIT_REACHED`.
- Cart changed to a book outside the coupon scope: expected `NO_APPLICABLE_ITEMS`.
- Coupon larger than the eligible subtotal: discount is capped at the subtotal and total stays at least zero.
- Product flash sale with insufficient remaining quantity: quote falls back to the next valid direct promotion or the original price.

For the final-use concurrency check, create a coupon with `total_usage_limit = 1`, keep enough stock for both requests, then send two identical `POST /api/orders` requests at the same time from separate Postman tabs. Exactly one should return `201`; the other should return `409` with `USAGE_LIMIT_REACHED`. Confirm `promotions.usage_count = 1` and one active `promotion_usages` row. Cancel the successful pending order through `PATCH /api/admin/orders/:id/status` with `{"status":"cancelled"}`; the usage count should return to zero once, and only once. Run this check only against a test database. If GHN is configured, the existing order-create path may still create a shipment; this promotion change does not alter that integration.
