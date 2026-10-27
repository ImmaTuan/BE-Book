-- Thêm bảng hồ sơ vào database hiện tại, không xóa hay thay đổi bảng users.
-- MySQL 8.0.16+; dùng cùng kiểu INT với users.id trong FINAL.drawio.
-- Chạy một lần trong phpMyAdmin > database cua_hang_sach > Import.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

CREATE TABLE `profiles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `first_name` VARCHAR(100) NULL COMMENT 'Tên gọi, ví dụ Tuấn',
  `last_name` VARCHAR(155) NULL COMMENT 'Họ và tên đệm, ví dụ Huỳnh Nguyễn Minh',
  `phone` VARCHAR(20) NULL COMMENT 'SĐT liên hệ riêng; NULL thì dùng users.phone',
  `email` VARCHAR(254) NULL COMMENT 'Email liên hệ riêng; NULL thì dùng users.email. Không phải email đăng nhập',
  `gender` VARCHAR(20) NOT NULL DEFAULT 'undisclosed',
  `date_of_birth` DATE NULL,
  `loyalty_points` INT NOT NULL DEFAULT 0,
  `membership_tier` VARCHAR(20) NOT NULL DEFAULT 'bronze',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_profiles_user_id` (`user_id`),
  CONSTRAINT `fk_profiles_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_profiles_gender`
    CHECK (`gender` IN ('male', 'female', 'other', 'undisclosed')),
  CONSTRAINT `ck_profiles_loyalty_points`
    CHECK (`loyalty_points` >= 0),
  CONSTRAINT `ck_profiles_membership_tier`
    CHECK (`membership_tier` IN ('bronze', 'silver', 'gold', 'platinum'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Final profile shape: one full_name field, with login email kept in users.
ALTER TABLE `profiles`
  ADD COLUMN `full_name` VARCHAR(255) NULL AFTER `user_id`,
  ADD COLUMN `shipping_address` TEXT NULL AFTER `phone`;

UPDATE `profiles` p
JOIN `users` u ON u.`id` = p.`user_id`
SET p.`full_name` = COALESCE(
  NULLIF(TRIM(CONCAT_WS(' ', p.`last_name`, p.`first_name`)), ''),
  u.`full_name`
);

ALTER TABLE `profiles`
  DROP COLUMN `first_name`,
  DROP COLUMN `last_name`,
  DROP COLUMN `email`;

-- Tạo hồ sơ cho khách hiện có và đồng bộ tên từ users.full_name.
-- Email đăng nhập chỉ được lưu trong users; profile không có trường email.
INSERT INTO `profiles` (`user_id`, `full_name`)
SELECT u.`id`, u.`full_name`
FROM `users` u
WHERE u.`role` = 'customer'
  AND NOT EXISTS (SELECT 1 FROM `profiles` p WHERE p.`user_id` = u.`id`);

-- Profile stores the customer name and shipping address. Login email remains in users.email.
-- Customers may edit full_name, phone, gender, date_of_birth, and shipping_address.
-- Only the system/admin may edit loyalty_points and membership_tier.
