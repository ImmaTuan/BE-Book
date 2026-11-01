-- Run once after the current cua_hang_sach schema has been imported.
-- Adds product discounts and order coupons without deleting existing data.
USE `cua_hang_sach2`;
SET NAMES utf8mb4;

ALTER TABLE `promotions`
  ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'order' AFTER `code`,
  ADD COLUMN `total_usage_limit` INT UNSIGNED NULL AFTER `is_active`,
  ADD COLUMN `usage_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `total_usage_limit`,
  ADD COLUMN `per_customer_limit` INT UNSIGNED NULL AFTER `usage_count`,
  ADD COLUMN `scope_type` VARCHAR(20) NOT NULL DEFAULT 'all' AFTER `per_customer_limit`,
  ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD KEY `idx_promotions_kind_period` (`kind`, `is_active`, `start_at`, `end_at`);

CREATE TABLE `product_promotions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `discount_type` VARCHAR(20) NOT NULL,
  `discount_value` DECIMAL(15,2) NOT NULL,
  `start_at` DATETIME NOT NULL,
  `end_at` DATETIME NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_promotions_active_period` (`is_active`, `start_at`, `end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_promotion_books` (
  `product_promotion_id` INT NOT NULL,
  `book_id` INT NOT NULL,
  `quantity_limit` INT UNSIGNED NULL,
  `quantity_used` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`product_promotion_id`, `book_id`),
  KEY `idx_product_promotion_books_book` (`book_id`),
  CONSTRAINT `fk_product_promotion_books_promotion`
    FOREIGN KEY (`product_promotion_id`) REFERENCES `product_promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_product_promotion_books_book`
    FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `coupon_books` (
  `promotion_id` INT NOT NULL,
  `book_id` INT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`promotion_id`, `book_id`),
  CONSTRAINT `fk_coupon_books_promotion`
    FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_coupon_books_book`
    FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `coupon_categories` (
  `promotion_id` INT NOT NULL,
  `category_id` INT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`promotion_id`, `category_id`),
  CONSTRAINT `fk_coupon_categories_promotion`
    FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_coupon_categories_category`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `promotion_usages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `promotion_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `code_snapshot` VARCHAR(50) NOT NULL,
  `name_snapshot` VARCHAR(255) NOT NULL,
  `discount_amount` DECIMAL(15,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'reserved',
  `used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `released_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promotion_usage_order` (`promotion_id`, `order_id`),
  KEY `idx_promotion_usage_user_status` (`user_id`, `promotion_id`, `status`),
  KEY `idx_promotion_usage_order_status` (`order_id`, `status`),
  CONSTRAINT `fk_promotion_usages_promotion`
    FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_promotion_usages_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_promotion_usages_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve any legacy coupon use already referenced by orders.promotion_id.
INSERT INTO `promotion_usages`
  (`promotion_id`, `order_id`, `user_id`, `code_snapshot`, `name_snapshot`, `discount_amount`, `status`, `used_at`, `released_at`)
SELECT p.id, o.id, o.user_id, p.code, p.name, o.discount_amount,
       CASE WHEN o.status = 'cancelled' THEN 'released'
            WHEN o.status = 'delivered' THEN 'used'
            ELSE 'reserved' END,
       o.created_at,
       CASE WHEN o.status = 'cancelled' THEN o.created_at ELSE NULL END
FROM orders o JOIN promotions p ON p.id = o.promotion_id
WHERE o.promotion_id IS NOT NULL;

UPDATE `promotions` p
SET p.usage_count = (
  SELECT COUNT(*) FROM promotion_usages u
  WHERE u.promotion_id = p.id AND u.status IN ('reserved', 'used')
);

ALTER TABLE `orders`
  ADD COLUMN `direct_discount_amount` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `subtotal`;

ALTER TABLE `order_items`
  ADD COLUMN `original_unit_price` DECIMAL(15,2) NULL AFTER `unit_price`,
  ADD COLUMN `direct_discount_amount` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `original_unit_price`,
  ADD COLUMN `product_promotion_id` INT NULL AFTER `direct_discount_amount`,
  ADD COLUMN `order_discount_amount` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `product_promotion_id`;

UPDATE `order_items` SET `original_unit_price` = `unit_price` WHERE `original_unit_price` IS NULL;
