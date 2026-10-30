-- DEMO DATA ONLY: randomly assigned publishers are not verified book imprints.
-- Existing assignments are preserved. Each unassigned book gets one sample publisher.
-- CRC32 provides stable pseudo-random assignments when the script is run again.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO `publisher` (`name`, `description`) VALUES
('Nhà xuất bản Kim Đồng', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Trẻ', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Văn học', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Hội Nhà văn', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Tổng hợp Thành phố Hồ Chí Minh', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Giáo dục Việt Nam', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Phụ nữ Việt Nam', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Lao động', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Thế Giới', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Dân Trí', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Hồng Đức', 'Dữ liệu mẫu cho cửa hàng sách.'),
('Nhà xuất bản Thanh Niên', 'Dữ liệu mẫu cho cửa hàng sách.')
ON DUPLICATE KEY UPDATE `id` = `publisher`.`id`;

INSERT INTO `book_publisher` (`book_id`, `publisher_id`)
SELECT b.`id`, p.`id` FROM `books` AS b
JOIN `publisher` AS p ON p.`name_key` = LOWER(ELT(
  MOD(CRC32(CONCAT('moc-publisher-demo:', b.`id`)), 12) + 1,
  'Nhà xuất bản Kim Đồng', 'Nhà xuất bản Trẻ', 'Nhà xuất bản Văn học',
  'Nhà xuất bản Hội Nhà văn', 'Nhà xuất bản Tổng hợp Thành phố Hồ Chí Minh',
  'Nhà xuất bản Giáo dục Việt Nam', 'Nhà xuất bản Phụ nữ Việt Nam',
  'Nhà xuất bản Lao động', 'Nhà xuất bản Thế Giới', 'Nhà xuất bản Dân Trí',
  'Nhà xuất bản Hồng Đức', 'Nhà xuất bản Thanh Niên'
)) COLLATE utf8mb4_bin
WHERE NOT EXISTS (SELECT 1 FROM `book_publisher` AS bp WHERE bp.`book_id` = b.`id`);

-- Keep the old scalar column as a primary-publisher cache for older clients.
UPDATE `books` AS b SET b.`publisher` = (
  SELECT p.`name` FROM `book_publisher` AS bp JOIN `publisher` AS p ON p.`id` = bp.`publisher_id`
  WHERE bp.`book_id` = b.`id` ORDER BY p.`name_key`, p.`id` LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM `book_publisher` AS bp WHERE bp.`book_id` = b.`id`);

COMMIT;
