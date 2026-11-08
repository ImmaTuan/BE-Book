import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/db.js';
try {
 const sql = await readFile(new URL('../database/add_customer_features.sql', import.meta.url), 'utf8');
 for (const statement of sql.split(';').map(x=>x.trim()).filter(Boolean)) await pool.query(statement);
 const [columns] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders'");
 const existing = new Set(columns.map(x=>x.COLUMN_NAME));
 for (const [name, definition] of Object.entries({ payment_expires_at: 'DATETIME NULL', expired_at: 'DATETIME NULL', expiration_checked_at: 'DATETIME NULL' })) {
   if (!existing.has(name)) await pool.query('ALTER TABLE orders ADD COLUMN ' + name + ' ' + definition);
 }
 const [[index]]=await pool.execute("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_payment_expiry'");
 if(!Number(index.n))await pool.query('ALTER TABLE orders ADD INDEX idx_orders_payment_expiry(payment_method,status,payment_status,payment_expires_at,expiration_checked_at)');
 // Keep the existing reviews table and data. Replace legacy guards that checked
 // the obsolete payments table with the current paid-and-delivered order rule.
 for (const [suffix, timing] of [['insert','INSERT'], ['update','UPDATE']]) {
   await pool.query('DROP TRIGGER IF EXISTS trg_reviews_before_' + suffix);
   await pool.query(`CREATE TRIGGER trg_reviews_before_${suffix} BEFORE ${timing} ON reviews FOR EACH ROW
    BEGIN
      IF NEW.rating < 1 OR NEW.rating > 5 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Review rating must be between 1 and 5';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.id=NEW.order_item_id AND oi.book_id=NEW.book_id AND o.user_id=NEW.user_id
        AND o.payment_status='paid' AND o.status<>'cancelled'
        AND (o.status='delivered' OR o.ghn_status='delivered')
        AND COALESCE(o.ghn_status,'') NOT IN ('cancel','returned')) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Review requires own paid and delivered purchase';
      END IF;
    END`);
 }
 await pool.execute("UPDATE orders SET payment_expires_at=DATE_ADD(created_at, INTERVAL 17 MINUTE) WHERE payment_method='vnpay' AND status='pending' AND payment_status IN ('unpaid','failed') AND payment_expires_at IS NULL");
 await pool.execute("INSERT INTO order_events(order_id,event_type,to_status,source,detail,event_key,created_at) SELECT id,'order_created','pending','system','Đơn được tạo trước khi bật lịch sử chi tiết','created',created_at FROM orders ON DUPLICATE KEY UPDATE id=order_events.id");
 console.log('Customer features schema and review guards are ready');
} finally { await pool.end(); }
