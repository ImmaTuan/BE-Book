-- Run once on databases where orders/order_items existed before GHN integration.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

ALTER TABLE `orders`
  ADD COLUMN `ghn_to_ward_name` VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN `ghn_to_province_name` VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN `ghn_to_district_name` VARCHAR(255) NULL,
  ADD COLUMN `ghn_is_new_to_address` BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE `order_items`
  ADD COLUMN `weight_grams` INT NOT NULL DEFAULT 1;
