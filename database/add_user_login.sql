-- Run once against cua_hang_sach to enable refresh-token sessions.
USE `cua_hang_sach`;
SET NAMES utf8mb4;

CREATE TABLE `user_login` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `refresh_token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `user_agent` VARCHAR(512) NULL,
  `ip_address` VARCHAR(45) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_login_refresh_token_hash` (`refresh_token_hash`),
  KEY `idx_user_login_user_id` (`user_id`),
  KEY `idx_user_login_expires_at` (`expires_at`),
  CONSTRAINT `fk_user_login_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
