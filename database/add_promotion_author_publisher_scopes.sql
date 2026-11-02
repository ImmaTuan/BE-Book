-- Run once after add_promotions.sql.
-- Adds author and publisher scopes without removing or rewriting existing promotions.
USE `cua_hang_sach2`;
SET NAMES utf8mb4;

ALTER TABLE `product_promotions`
  ADD COLUMN `scope_type` VARCHAR(20) NOT NULL DEFAULT 'books' AFTER `is_active`,
  ADD COLUMN `scope_ids` JSON NULL AFTER `scope_type`;

CREATE TABLE `coupon_authors` (
  `promotion_id` INT NOT NULL,
  `author_id` INT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`promotion_id`, `author_id`),
  CONSTRAINT `fk_coupon_authors_promotion` FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_coupon_authors_author` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `coupon_publishers` (
  `promotion_id` INT NOT NULL,
  `publisher_id` INT NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`promotion_id`, `publisher_id`),
  CONSTRAINT `fk_coupon_publishers_promotion` FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_coupon_publishers_publisher` FOREIGN KEY (`publisher_id`) REFERENCES `publisher` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
