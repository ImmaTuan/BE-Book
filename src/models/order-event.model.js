import { pool } from '../config/db.js';
import { normalizeDeliveryDate } from '../delivery-estimate.js';
const states = { pending:'Chờ xác nhận', confirmed:'Đã xác nhận', processing:'Đang chuẩn bị', shipped:'Đang giao', delivered:'Đã giao', cancelled:'Đã hủy' };
const titles = {
 order_created:'Đặt hàng thành công', order_status:'Đơn hàng được cập nhật',
 payment_paid:'Thanh toán thành công', payment_failed:'Thanh toán chưa thành công',
 payment_review:'Thanh toán cần đối soát', payment_expired:'Đơn hàng hết hạn thanh toán',
 expiry_review:'Chờ đối soát thanh toán', shipment_created:'Đã tạo vận đơn',
 shipping_status:'Cập nhật vận chuyển',
};
export async function recordOrderEvent(db, order, { type, from=null, to=null, actorId=null, source='system', detail=null, key=null, notify=true }) {
 const [event] = await db.execute(
  'INSERT INTO order_events(order_id,event_type,from_status,to_status,actor_user_id,source,detail,event_key) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
  [order.id,type,from,to,actorId,source,detail,key],
 );
 if (notify && event.insertId) {
  const title = titles[type] || 'Đơn hàng được cập nhật';
  const message = detail || (states[to] ? 'Trạng thái: '+states[to] : title);
  await db.execute('INSERT INTO notifications(user_id,order_id,event_id,title,message) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
   [order.user_id,order.id,event.insertId,title,order.order_code+' · '+message]);
 }
}
export async function listOrderEvents(orderId) {
 const [rows]=await pool.execute('SELECT id,event_type,from_status,to_status,source,detail,created_at FROM order_events WHERE order_id=? ORDER BY id', [orderId]);
 return rows.map(row=>({...row,created_at:normalizeDeliveryDate(row.created_at)}));
}
