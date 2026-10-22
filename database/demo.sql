-- CHỈ chạy file này nếu CHƯA có database cua_hang_sach từ FINAL.drawio.
-- Database đã có đầy đủ 11 bảng: không cần import, giữ nguyên dữ liệu cũ.
CREATE DATABASE IF NOT EXISTS cua_hang_sach CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cua_hang_sach;
CREATE TABLE IF NOT EXISTS users (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 full_name VARCHAR(255) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 phone VARCHAR(20) NULL,
 role VARCHAR(20) NOT NULL DEFAULT 'customer',
 is_active BOOLEAN NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ck_users_demo_role CHECK (role IN ('admin','customer'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS categories (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS books (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 category_id INT NOT NULL,
 title VARCHAR(255) NOT NULL,
 description TEXT NULL,
 cover_url VARCHAR(2048) NULL,
 price FLOAT NOT NULL,
 stock_quantity INT NOT NULL DEFAULT 0,
 publisher VARCHAR(255) NULL,
 publication_year INT NULL,
 is_active BOOLEAN NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 weight_grams INT NOT NULL,
 CONSTRAINT fk_books_category_id FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_books_demo_price CHECK (price >= 0),
 CONSTRAINT ck_books_demo_stock CHECK (stock_quantity >= 0),
 CONSTRAINT ck_books_demo_weight CHECK (weight_grams > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO categories (name) VALUES ('Sách demo') ON DUPLICATE KEY UPDATE name = 'Sách demo';
