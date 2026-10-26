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

-- Tạo hồ sơ trống cho khách hiện có, không tự suy đoán họ/tên từ full_name.
-- Email/SĐT NULL dùng thông tin users hiện có; không sao chép để tránh dữ liệu lỗi thời.
INSERT INTO `profiles` (`user_id`)
SELECT u.`id`
FROM `users` u
WHERE u.`role` = 'customer'
  AND NOT EXISTS (SELECT 1 FROM `profiles` p WHERE p.`user_id` = u.`id`);

-- QUY TẮC CHO BACKEND KHI BỔ SUNG API PROFILE:
-- 1. Đăng ký khách mới: tạo users + profiles trong cùng transaction.
-- 2. Lấy user_id từ phiên đăng nhập, chỉ cho khách xem/sửa hồ sơ của mình.
-- 3. Khách được sửa: first_name, last_name, phone, email, gender, date_of_birth.
--    Khách KHÔNG được sửa user_id, loyalty_points, membership_tier.
-- 4. Kiểm tra định dạng email/SĐT, ngày sinh hợp lệ và không ở tương lai.
-- 5. Hạng bronze/silver/gold/platinum là bộ giá trị đề xuất; chưa quy định ngưỡng điểm.
--    Hệ thống/Admin cập nhật điểm và hạng; bảng này chưa có lịch sử cộng/trừ điểm.
-- 6. Email đăng nhập chuẩn vẫn là users.email (UNIQUE). Đổi email liên hệ không đổi login.
--    Nếu muốn đổi email login: dùng luồng xác minh riêng, kiểm tra trùng users.email.
-- 7. Tên hồ sơ hiển thị từ last_name + first_name; khi chưa nhập thì dùng users.full_name.
-- 8. Truy vấn email liên hệ: COALESCE(profiles.email, users.email); tương tự phone.
--    Dùng NULL để trở về email/SĐT tài khoản, không dùng chuỗi rỗng.
-- 9. File này CHỈ thêm bảng/hồ sơ trống, chưa thêm API vào backend và chưa sửa file draw.io.
