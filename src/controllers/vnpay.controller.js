import { getVnpayConfig } from '../config/vnpay.js';
import * as orders from '../models/promotional-order.model.js';
import { findVnpayPayment, settleVnpayPayment } from '../models/vnpay-payment.model.js';
import { paymentIp, verifyVnpayCallback } from '../services/vnpay.service.js';
import { prepareVnpayPayment, checkVnpayOrder } from '../services/order-vnpay.service.js';
import { fail, id } from '../validation.js';

async function ownOrder(req) {
  if (req.body && Object.keys(req.body).length) fail('API thanh toán không nhận số tiền hoặc thông tin thanh toán từ client');
  const order = await orders.findCustomerOrder(id(req.params.id), req.user.id);
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  return order;
}

export async function createPayment(req, res) {
  const order = await ownOrder(req);
  const payment = await prepareVnpayPayment(order, req.user.id, paymentIp(req));
  res.json({ data: { payment, order: await orders.findOrder(order.id) } });
}

export async function checkPayment(req, res) {
  const order = await ownOrder(req);
  res.json({ data: await checkVnpayOrder(order, paymentIp(req)) });
}

export async function ipn(req, res) {
  try {
    const params = verifyVnpayCallback(req.query);
    if (!params) return res.json({ RspCode: '97', Message: 'Invalid signature' });
    return res.json(await settleVnpayPayment(params));
  } catch {
    // VNPAY retries 99 responses. Do not expose secrets, SQL or raw callbacks.
    return res.json({ RspCode: '99', Message: 'Unable to confirm payment' });
  }
}

export async function paymentReturn(req, res) {
  const config = getVnpayConfig();
  const destination = new URL(config.frontendUrl);
  destination.searchParams.set('payment', 'vnpay');
  const params = verifyVnpayCallback(req.query, config);
  const attempt = params ? await findVnpayPayment(params.vnp_TxnRef) : null;
  // Production uses IPN/QueryDR. Local sandbox can explicitly accept VNPAY's
  // signed return receipt because its QueryDR endpoint may return error 99 and
  // localhost cannot receive IPN. The exact same DB amount/transaction checks
  // and idempotency as IPN still apply; browser success flags are never trusted.
  let valid = Boolean(params && attempt);
  if (valid && config.confirmSandboxReturn) {
    const confirmation = await settleVnpayPayment(params);
    valid = ['00', '02'].includes(confirmation.RspCode);
  }
  destination.searchParams.set('result', valid ? 'checking' : 'invalid');
  if (attempt) destination.searchParams.set('order_id', String(attempt.order_id));
  res.redirect(303, destination.toString());
}
