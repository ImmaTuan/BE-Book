import { recordOrderEvent } from './order-event.model.js';
import { normalizeDeliveryDate } from '../delivery-estimate.js';
import { randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { fail } from '../validation.js';
import { toDeliverySqlDate } from '../delivery-estimate.js';
import { buildPaymentUrl, vnpayDate } from '../services/vnpay.service.js';

export async function latestVnpayPayment(orderId) {
  const [rows] = await pool.execute('SELECT * FROM vnpay_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
  return rows[0] || null;
}

export async function findVnpayPayment(reference) {
  const [rows] = await pool.execute('SELECT * FROM vnpay_payments WHERE reference = ?', [reference]);
  return rows[0] || null;
}

export async function createVnpayPayment(orderId, userId, shippingFee, ip) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order || order.user_id !== userId) fail('Không tìm thấy đơn hàng', 404);
    if(order.payment_expires_at && Date.parse(normalizeDeliveryDate(order.payment_expires_at))<=Date.now())fail('Đơn đã quá thời hạn giữ hàng, vui lòng chờ hệ thống xử lý hết hạn',409);
    if (order.payment_method !== 'vnpay' || !['unpaid', 'failed'].includes(order.payment_status) || order.status !== 'pending') fail('Đơn hàng không thể thanh toán VNPAY', 409);
    const [[active]] = await db.execute("SELECT * FROM vnpay_payments WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1 FOR UPDATE", [orderId]);
    // A pending attempt is reused even after expiry until QueryDR/IPN establishes
    // its outcome. This prevents paying a second time after a lost callback.
    if (active) { await db.commit(); return active; }
    const amount = Math.round(Number(order.subtotal) - Number(order.discount_amount) + shippingFee);
    const reference = 'VP' + order.id + randomBytes(12).toString('hex');
    const createdAt = new Date();
    const expiresAt = new Date(Math.min(createdAt.getTime()+15*60000,order.payment_expires_at?Date.parse(normalizeDeliveryDate(order.payment_expires_at))-2*60000:Infinity));
    if(expiresAt<=createdAt)fail('Đơn sắp hết hạn; không tạo liên kết thanh toán mới',409);
    const paymentUrl = buildPaymentUrl({ reference, amount, ip, createdAt, expiresAt });
    await db.execute("UPDATE orders SET shipping_fee = ?, total_amount = ?, cod_amount = 0, payment_status = 'unpaid' WHERE id = ?", [shippingFee, amount, orderId]);
    await db.execute(
      'INSERT INTO vnpay_payments (order_id, reference, amount, payment_url, create_date, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [orderId, reference, amount, paymentUrl, vnpayDate(createdAt), toDeliverySqlDate(expiresAt)],
    );
    await db.commit();
    return { order_id: orderId, reference, amount, payment_url: paymentUrl, create_date: vnpayDate(createdAt), expires_at: toDeliverySqlDate(expiresAt), status: 'pending' };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}

// All callers pass a verified VNPAY IPN or a verified QueryDR result.
export async function settleVnpayPayment(params) {
  const known = await findVnpayPayment(params.vnp_TxnRef);
  if (!known) return { RspCode: '01', Message: 'Order not found' };
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Match the lock order used when creating a payment and cancelling an order.
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [known.order_id]);
    const [[attempt]] = await db.execute('SELECT * FROM vnpay_payments WHERE reference = ? FOR UPDATE', [known.reference]);
    if (!order || order.payment_method !== 'vnpay' || !attempt) { await db.rollback(); return { RspCode: '01', Message: 'Order not found' }; }
    if (Number(params.vnp_Amount) !== Number(attempt.amount) * 100 || Number(order.total_amount) !== Number(attempt.amount)) {
      await db.rollback(); return { RspCode: '04', Message: 'Invalid amount' };
    }
    const success = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
    if (attempt.status === 'succeeded' || (attempt.status !== 'pending' && !success)) {
      await db.commit(); return { RspCode: '02', Message: 'Order already confirmed' };
    }
    if (success && !/^[1-9]\d{0,14}$/.test(String(params.vnp_TransactionNo || ''))) {
      await db.rollback(); return { RspCode: '97', Message: 'Invalid transaction number' };
    }
    if (params.vnp_TransactionStatus === '01') { await db.commit(); return { RspCode: '00', Message: 'Transaction pending' }; }
    const review = ['04', '05', '06', '07', '09'].includes(params.vnp_TransactionStatus) || params.vnp_ResponseCode === '07';
    await db.execute(
      'UPDATE vnpay_payments SET status = ?, transaction_no = ?, response_code = ?, transaction_status = ? WHERE id = ?',
      [success ? 'succeeded' : review ? 'review' : 'failed', success ? params.vnp_TransactionNo : null, params.vnp_ResponseCode, params.vnp_TransactionStatus, attempt.id],
    );
    if (success) {
      const status = order.status === 'cancelled' || ['paid', 'refund_required'].includes(order.payment_status) ? 'refund_required' : 'paid';
      await db.execute("UPDATE orders SET payment_status = ?, paid_at = COALESCE(paid_at, NOW()), cod_amount = 0 WHERE id = ?", [status, order.id]);
    } else if (!['paid', 'refund_required'].includes(order.payment_status) && order.status !== 'cancelled') {
      await db.execute('UPDATE orders SET payment_status = ? WHERE id = ?', [review ? 'review_required' : 'failed', order.id]);
    }
    await recordOrderEvent(db,order,{type:success?(order.status==='cancelled'||['paid','refund_required'].includes(order.payment_status)?'payment_review':'payment_paid'):review?'payment_review':'payment_failed',source:'vnpay',to:success?(order.status==='cancelled'||['paid','refund_required'].includes(order.payment_status)?'refund_required':'paid'):review?'review_required':'failed',key:'vnpay:'+attempt.reference+':'+(success?'paid':review?'review':'failed')});
    await db.commit();
    return { RspCode: '00', Message: 'Confirm Success' };
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}


// Called only after the VNPAY server itself reports no such transaction, with
// a grace period after link expiry. It does not infer success from browser data.
export async function expireMissingVnpayPayment(attempt) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [attempt.order_id]);
    const [result] = await db.execute("UPDATE vnpay_payments SET status = 'expired' WHERE id = ? AND status = 'pending' AND expires_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)", [attempt.id]);
    if (result.affectedRows && order?.payment_method === 'vnpay' && order.payment_status === 'unpaid' && order.status === 'pending') {
      await db.execute("UPDATE orders SET payment_status = 'failed' WHERE id = ?", [order.id]);
    }
    await db.commit();
  } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
}
