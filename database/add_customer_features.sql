CREATE TABLE IF NOT EXISTS order_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL, event_type VARCHAR(40) NOT NULL,
 from_status VARCHAR(50) NULL, to_status VARCHAR(50) NULL,
 actor_user_id INT NULL, source VARCHAR(20) NOT NULL,
 detail VARCHAR(1000) NULL, event_key VARCHAR(100) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_order_event (order_id, event_key),
 KEY idx_order_events (order_id, id),
 FOREIGN KEY (order_id) REFERENCES orders(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS notifications (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL, order_id INT NOT NULL, event_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(255) NOT NULL, message VARCHAR(1000) NOT NULL,
 read_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_notification_event (user_id,event_id),
 KEY idx_notifications_user (user_id,read_at,id),
 FOREIGN KEY (user_id) REFERENCES users(id),
 FOREIGN KEY (order_id) REFERENCES orders(id),
 FOREIGN KEY (event_id) REFERENCES order_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS wishlists (
 user_id INT NOT NULL, book_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,book_id),
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(book_id) REFERENCES books(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS reviews (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL, book_id INT NOT NULL, order_item_id INT NOT NULL,
 rating INT NOT NULL, comment TEXT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_reviews_user_id_book_id(user_id,book_id),
 UNIQUE KEY uq_reviews_order_item_id(order_item_id),
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(book_id) REFERENCES books(id),
 FOREIGN KEY(order_item_id) REFERENCES order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
