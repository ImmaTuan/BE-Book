-- Use only if the previous merge_profile_names.sql was already applied.
-- If profiles still has first_name/last_name, run the current merge_profile_names.sql instead.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

ALTER TABLE `profiles`
  ADD COLUMN `shipping_address` TEXT NULL AFTER `phone`,
  DROP COLUMN `email`;
