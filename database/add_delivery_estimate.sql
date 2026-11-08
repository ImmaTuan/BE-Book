-- Existing databases: run once, or use npm run migrate:delivery (safe to rerun).
ALTER TABLE `orders` ADD COLUMN `ghn_expected_delivery_at` DATETIME NULL;
ALTER TABLE `orders` ADD COLUMN `ghn_delivery_checked_at` DATETIME NULL;
ALTER TABLE `orders` ADD COLUMN `processing_started_at` DATETIME NULL;
