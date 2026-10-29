-- Run once to add the basic order tables when using database/demo.sql.
-- Existing cua_hang_sach databases already have these tables; IF NOT EXISTS keeps them intact.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `order_code` VARCHAR(50) NOT NULL,
  `recipient_name` VARCHAR(255) NOT NULL,
  `recipient_phone` VARCHAR(20) NOT NULL,
  `shipping_address` TEXT NOT NULL,
  `subtotal` FLOAT NOT NULL,
  `shipping_fee` FLOAT NOT NULL DEFAULT 0,
  `total_amount` FLOAT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `promotion_id` INT NULL,
  `discount_amount` FLOAT NOT NULL DEFAULT 0,
  `ghn_shop_id` INT NOT NULL DEFAULT 0,
  `to_district_id` INT NOT NULL DEFAULT 0,
  `to_ward_code` VARCHAR(20) NOT NULL DEFAULT '',
  `package_weight_grams` INT NOT NULL DEFAULT 1,
  `package_length_cm` INT NOT NULL DEFAULT 1,
  `package_width_cm` INT NOT NULL DEFAULT 1,
  `package_height_cm` INT NOT NULL DEFAULT 1,
  `service_type_id` INT NOT NULL DEFAULT 0,
  `payment_type_id` INT NOT NULL DEFAULT 0,
  `cod_amount` FLOAT NOT NULL DEFAULT 0,
  `insurance_value` FLOAT NOT NULL DEFAULT 0,
  `ghn_order_code` VARCHAR(50) NULL,
  `ghn_status` VARCHAR(50) NULL,
  `ghn_to_ward_name` VARCHAR(255) NOT NULL DEFAULT '',
  `ghn_to_province_name` VARCHAR(255) NOT NULL DEFAULT '',
  `ghn_to_district_name` VARCHAR(255) NULL,
  `ghn_is_new_to_address` BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_code` (`order_code`),
  UNIQUE KEY `uq_orders_ghn_order_code` (`ghn_order_code`),
  KEY `idx_orders_user_id` (`user_id`),
  KEY `idx_orders_created_status` (`created_at`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `book_id` INT NOT NULL,
  `book_title` VARCHAR(255) NOT NULL,
  `unit_price` FLOAT NOT NULL,
  `quantity` INT NOT NULL,
  `weight_grams` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order_id` (`order_id`),
  KEY `idx_order_items_book_id` (`book_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
