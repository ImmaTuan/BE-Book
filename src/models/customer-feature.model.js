import { pool } from '../config/db.js';
import { fail } from '../validation.js';
import { normalizeDeliveryDate } from '../delivery-estimate.js';

export async function notifications(userId, { page,limit,offset }) {
 const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total FROM notifications WHERE user_id=?',[userId]);
 const [[{unread}]]=await pool.execute('SELECT COUNT(*) AS unread FROM notifications WHERE user_id=? AND read_at IS NULL',[userId]);
 const [rows]=await pool.execute(`SELECT id,order_id,title,message,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,[userId]);
 return {data:rows.map(x=>({...x,created_at:normalizeDeliveryDate(x.created_at),read_at:normalizeDeliveryDate(x.read_at)})),meta:{page,limit,total:Number(total),unread:Number(unread)}};
}
export async function markNotification(userId, notificationId=null) {
 if(notificationId===null){await pool.execute('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=?',[userId]);return;}
 const [[row]]=await pool.execute('SELECT id FROM notifications WHERE id=? AND user_id=?',[notificationId,userId]);
 if(!row)fail('Không tìm thấy thông báo',404);
 await pool.execute('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=? AND user_id=?',[notificationId,userId]);
}
export async function wishlist(userId,{page,limit,offset}) {
 const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total FROM wishlists WHERE user_id=?',[userId]);
 const [rows]=await pool.execute(`SELECT b.id,b.title,b.cover_url,b.price,b.stock_quantity,b.is_active,w.created_at FROM wishlists w JOIN books b ON b.id=w.book_id WHERE w.user_id=? ORDER BY w.created_at DESC,b.id DESC LIMIT ${limit} OFFSET ${offset}`,[userId]);
 return {data:rows.map(x=>({...x,created_at:normalizeDeliveryDate(x.created_at)})),meta:{page,limit,total:Number(total)}};
}
export async function wishlistState(userId,bookId) {
 const [[row]]=await pool.execute('SELECT 1 AS saved FROM wishlists WHERE user_id=? AND book_id=?',[userId,bookId]);
 return Boolean(row);
}
export async function setWishlist(userId,bookId,saved) {
 if(!saved){await pool.execute('DELETE FROM wishlists WHERE user_id=? AND book_id=?',[userId,bookId]);return;}
 const [result]=await pool.execute('INSERT IGNORE INTO wishlists(user_id,book_id) SELECT ?,id FROM books WHERE id=? AND is_active=1',[userId,bookId]);
 if(!result.affectedRows&&!await wishlistState(userId,bookId))fail('Sách không còn hiển thị',404);
}
const eligible = "o.user_id=? AND oi.book_id=? AND o.payment_status='paid' AND o.status<>'cancelled' AND (o.status='delivered' OR o.ghn_status='delivered') AND COALESCE(o.ghn_status,'') NOT IN ('cancel','returned')";
export async function reviewEligibility(userId,bookId) {
 const [[item]]=await pool.execute('SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE '+eligible+' ORDER BY oi.id LIMIT 1',[userId,bookId]);
 const [[review]]=await pool.execute('SELECT id,rating,comment,created_at FROM reviews WHERE user_id=? AND book_id=?',[userId,bookId]);
 return {eligible:Boolean(item),review:review?{...review,created_at:normalizeDeliveryDate(review.created_at)}:null};
}
export async function listReviews(bookId,{page,limit,offset}) {
 const [[book]]=await pool.execute('SELECT id FROM books WHERE id=? AND is_active=1',[bookId]);
 if(!book)fail('Không tìm thấy sách',404);
 const [[summary]]=await pool.execute('SELECT COUNT(*) AS total,COALESCE(ROUND(AVG(rating),1),0) AS average FROM reviews WHERE book_id=?',[bookId]);
 const [rows]=await pool.execute(`SELECT r.id,r.rating,r.comment,r.created_at,SUBSTRING_INDEX(u.full_name,' ',1) AS display_name,
 (o.payment_status='paid' AND o.status<>'cancelled' AND (o.status='delivered' OR o.ghn_status='delivered') AND COALESCE(o.ghn_status,'') NOT IN ('cancel','returned')) AS verified_purchase
 FROM reviews r JOIN users u ON u.id=r.user_id JOIN order_items oi ON oi.id=r.order_item_id JOIN orders o ON o.id=oi.order_id
 WHERE r.book_id=? ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`,[bookId]);
 return {data:rows.map(x=>({...x,verified_purchase:Boolean(x.verified_purchase),created_at:normalizeDeliveryDate(x.created_at)})),meta:{page,limit,total:Number(summary.total),average:Number(summary.average)}};
}
export async function saveReview(userId,bookId,{rating,comment}) {
 const db=await pool.getConnection();
 try{
  await db.beginTransaction();
  await db.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  const [[book]]=await db.execute('SELECT id FROM books WHERE id=? AND is_active=1',[bookId]);
  if(!book)fail('Sách không còn hiển thị',404);
  const [[item]]=await db.execute('SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE '+eligible+' ORDER BY oi.id LIMIT 1 FOR UPDATE',[userId,bookId]);
  if(!item)fail('Chỉ khách đã thanh toán và nhận sách mới được đánh giá',403);
  await db.execute('INSERT INTO reviews(user_id,book_id,order_item_id,rating,comment) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE order_item_id=VALUES(order_item_id),rating=VALUES(rating),comment=VALUES(comment)',[userId,bookId,item.id,rating,comment]);
  await db.commit();
 }catch(error){await db.rollback();throw error;}finally{db.release();}
}
export async function removeReview(userId,bookId){await pool.execute('DELETE FROM reviews WHERE user_id=? AND book_id=?',[userId,bookId]);}
