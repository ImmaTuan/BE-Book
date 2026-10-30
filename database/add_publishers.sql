-- Publisher normalization for the current books schema.
-- Re-running this migration preserves existing publishers and links.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `publisher` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `name_key` varchar(255) COLLATE utf8mb4_bin GENERATED ALWAYS AS (lower(trim(`name`))) STORED,
  `description` text DEFAULT NULL,
  `website` varchar(2048) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_publisher_name_key` (`name_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `book_publisher` (
  `book_id` int(11) NOT NULL,
  `publisher_id` int(11) NOT NULL,
  PRIMARY KEY (`book_id`, `publisher_id`),
  KEY `idx_book_publisher_publisher` (`publisher_id`),
  CONSTRAINT `fk_book_publisher_book` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_book_publisher_publisher` FOREIGN KEY (`publisher_id`) REFERENCES `publisher` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `publisher` (`name`)
SELECT DISTINCT TRIM(b.`publisher`) FROM `books` AS b
WHERE b.`publisher` IS NOT NULL AND TRIM(b.`publisher`) <> ''
ON DUPLICATE KEY UPDATE `id` = `publisher`.`id`;

-- Only migrate books without normalized links. books.publisher is a legacy cache.
INSERT INTO `book_publisher` (`book_id`, `publisher_id`)
SELECT b.`id`, p.`id` FROM `books` AS b
JOIN `publisher` AS p ON p.`name_key` = LOWER(TRIM(b.`publisher`)) COLLATE utf8mb4_bin
WHERE NOT EXISTS (SELECT 1 FROM `book_publisher` AS bp WHERE bp.`book_id` = b.`id`);

COMMIT;
