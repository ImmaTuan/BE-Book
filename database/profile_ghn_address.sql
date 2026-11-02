-- Run once against the active cua_hang_sach database.
-- Keeps shipping_address as the specific street/house address and stores GHN locations separately.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

ALTER TABLE `profiles`
  ADD COLUMN `shipping_province_id` INT NULL AFTER `shipping_address`,
  ADD COLUMN `shipping_province_name` VARCHAR(255) NULL AFTER `shipping_province_id`,
  ADD COLUMN `shipping_ward_code` VARCHAR(20) NULL AFTER `shipping_province_name`,
  ADD COLUMN `shipping_ward_name` VARCHAR(255) NULL AFTER `shipping_ward_code`,
  ADD COLUMN `shipping_district_name` VARCHAR(255) NULL AFTER `shipping_ward_name`,
  ADD COLUMN `shipping_is_new_to_address` TINYINT(1) NOT NULL DEFAULT 1 AFTER `shipping_district_name`;
