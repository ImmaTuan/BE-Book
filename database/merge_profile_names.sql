-- Run once on an existing profiles table that still has first_name/last_name and email.
-- Copies the existing profile name when present, otherwise users.full_name,
-- then removes the split columns. No profile rows are deleted.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

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
