-- Run once after reviewing the preview queries below and backing up the database.
-- Existing FLOAT amounts are rounded to two decimal places during conversion.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

-- Review existing fractional values before conversion:
SELECT id, price FROM books WHERE price <> ROUND(price, 2) LIMIT 100;
SELECT id, subtotal, total_amount, discount_amount
FROM orders
WHERE subtotal <> ROUND(subtotal, 2)
   OR total_amount <> ROUND(total_amount, 2)
   OR discount_amount <> ROUND(discount_amount, 2)
LIMIT 100;

ALTER TABLE `books`
  MODIFY `price` DECIMAL(15,2) NOT NULL;

ALTER TABLE `orders`
  MODIFY `subtotal` DECIMAL(15,2) NOT NULL,
  MODIFY `total_amount` DECIMAL(15,2) NOT NULL,
  MODIFY `discount_amount` DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE `order_items`
  MODIFY `unit_price` DECIMAL(15,2) NOT NULL;

ALTER TABLE `promotions`
  MODIFY `discount_value` DECIMAL(15,2) NOT NULL,
  MODIFY `min_order_amount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  MODIFY `max_discount_amount` DECIMAL(15,2) NULL;

ALTER TABLE `payments`
  MODIFY `amount` DECIMAL(15,2) NOT NULL;
