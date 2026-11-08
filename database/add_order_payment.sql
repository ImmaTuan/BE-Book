-- Existing orders used COD; backfill paid/cancelled only when adding payment_status.
ALTER TABLE `orders` ADD COLUMN `payment_method` VARCHAR(20) NOT NULL DEFAULT 'cod';
ALTER TABLE `orders` ADD COLUMN `payment_status` VARCHAR(20) NOT NULL DEFAULT 'unpaid';
ALTER TABLE `orders` ADD COLUMN `paid_at` DATETIME NULL;
