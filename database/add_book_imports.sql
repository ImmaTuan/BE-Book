CREATE TABLE IF NOT EXISTS book_imports (
 id CHAR(36) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 mode VARCHAR(12) NOT NULL,
 file_name VARCHAR(255) NOT NULL,
 file_sha256 CHAR(64) NOT NULL,
 rows_json MEDIUMTEXT NOT NULL,
 selections_json MEDIUMTEXT NOT NULL,
 preview_json MEDIUMTEXT NOT NULL,
 preview_hash CHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'preview',
 result_json MEDIUMTEXT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at DATETIME NOT NULL,
 completed_at DATETIME NULL,
 UNIQUE KEY uq_book_import_file(user_id,mode,file_sha256),
 KEY idx_book_import_user(user_id,created_at),
 CONSTRAINT fk_book_import_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
