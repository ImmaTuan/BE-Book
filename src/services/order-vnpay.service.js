import * as orders from '../models/promotional-order.model.js';
import * as payments from '../models/vnpay-payment.model.js';
import * as ghn from './ghn.service.js';
import { queryVnpayTransaction } from './vnpay.service.js';
import { normalizeDeliveryDate } from '../delivery-estimate.js';
import { getVnpayConfig } from '../config/vnpay.js';
import { fail } from '../validation.js';

export async function prepareVnpayPayment(order, userId, ip) {
  getVnpayConfig();
  if (order.payment_method !== 'vnpay' || order.status !== 'pending' || !['unpaid', 'failed'].includes(order.payment_status)) fail('Đơn hàng không thể thanh toán VNPAY', 409);
  const latest = await payments.latestVnpayPayment(order.id);
  if (latest?.status === 'pending') {
    const expiry = normalizeDeliveryDate(latest.expires_at);
    if (expiry && Date.parse(expiry) < Date.now()) fail('Liên kết đã hết hạn. Vui lòng bấm Kiểm tra thanh toán trước khi thử lại.', 409);
    return { url: latest.payment_url, expires_at: latest.expires_at, amount: Number(latest.amount) };
  }
  if (latest?.status === 'review') fail('Giao dịch cần được đối soát trước khi thanh toán lại', 409);
  let shippingFee = Number(order.shipping_fee || 0);
  if (!latest) {
    if (!ghn.isGhnConfigured()) fail('Cần cấu hình GHN để xác định phí giao hàng trước khi thanh toán VNPAY', 503);
    const preview = await ghn.previewGhnShipment(order);
    shippingFee = preview.fee;
  }
  const attempt = await payments.createVnpayPayment(order.id, userId, shippingFee, ip);
  return { url: attempt.payment_url, expires_at: attempt.expires_at, amount: Number(attempt.amount) };
}

export async function checkVnpayOrder(order, ip) {
  if (order.payment_method !== 'vnpay') fail('Đơn hàng không dùng VNPAY', 409);
  const attempt = await payments.latestVnpayPayment(order.id);
  if (attempt?.status === 'pending' || attempt?.status === 'review') {
    const result = await queryVnpayTransaction(attempt, ip);
    if (result.code === '91') await payments.expireMissingVnpayPayment(attempt);
    if (result.params) {
      const confirmation = await payments.settleVnpayPayment(result.params);
      if (!['00', '02'].includes(confirmation.RspCode)) fail('Không đối chiếu được giao dịch VNPAY với đơn hàng', 409);
    }
  }
  return orders.findOrder(order.id);
}
