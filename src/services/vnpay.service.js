import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { getVnpayConfig } from '../config/vnpay.js';
import { fail } from '../validation.js';

export const QUERY_RESPONSE_FIELDS = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
const hmac = (data, secret) => createHmac('sha512', secret).update(data, 'utf8').digest('hex');
const encode = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+');

export function canonicalVnpayParams(params) {
  return Object.keys(params).filter(key => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType')
    .sort().map(key => encode(key) + '=' + encode(params[key])).join('&');
}

export function signVnpayParams(params, secret) {
  return hmac(canonicalVnpayParams(params), secret);
}

export function validHash(actual, expected) {
  return typeof actual === 'string' && /^[a-fA-F0-9]{128}$/.test(actual)
    && timingSafeEqual(Buffer.from(actual.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}

export function vnpayDate(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
}

export function paymentIp(req) {
  const address = String(req.ip || req.socket?.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
  return address === '::1' || !isIP(address) ? '127.0.0.1' : address;
}

export function buildPaymentUrl({ reference, amount, ip, createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + 15 * 60000) }, config = getVnpayConfig()) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount * 100 > 999999999999) fail('Số tiền thanh toán VNPAY không hợp lệ');
  const params = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(amount * 100), vnp_CurrCode: 'VND', vnp_TxnRef: reference,
    vnp_OrderInfo: 'Thanh toan don hang ' + reference, vnp_OrderType: 'other',
    vnp_Locale: 'vn', vnp_ReturnUrl: config.returnUrl, vnp_IpAddr: ip,
    vnp_CreateDate: vnpayDate(createdAt), vnp_ExpireDate: vnpayDate(expiresAt),
  };
  return config.paymentUrl + '?' + canonicalVnpayParams(params) + '&vnp_SecureHash=' + signVnpayParams(params, config.hashSecret);
}

export function verifyVnpayCallback(query, config = getVnpayConfig()) {
  if (!query || typeof query !== 'object') return null;
  const params = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('vnp_')) continue;
    if (typeof value !== 'string' || value.length > 2048) return null;
    params[key] = value;
  }
  if (params.vnp_TmnCode !== config.tmnCode || !validHash(params.vnp_SecureHash, signVnpayParams(params, config.hashSecret))) return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(params.vnp_TxnRef || '') || !/^\d{1,12}$/.test(params.vnp_Amount || '')) return null;
  if (!/^\d{2}$/.test(params.vnp_ResponseCode || '') || !/^\d{2}$/.test(params.vnp_TransactionStatus || '')) return null;
  if (params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00' && !/^[1-9]\d{0,14}$/.test(params.vnp_TransactionNo || '')) return null;
  return params;
}

// QueryDR lets a local backend reconcile directly with VNPAY without a public
// IPN endpoint. Never use the browser Return URL to mark an order paid.
export async function queryVnpayTransaction(attempt, ip, config = getVnpayConfig()) {
  const params = {
    vnp_RequestId: randomBytes(16).toString('hex'), vnp_Version: '2.1.0', vnp_Command: 'querydr',
    vnp_TmnCode: config.tmnCode, vnp_TxnRef: attempt.reference,
    vnp_TransactionDate: attempt.create_date, vnp_CreateDate: vnpayDate(),
    vnp_IpAddr: ip, vnp_OrderInfo: 'Kiem tra giao dich ' + attempt.reference,
  };
  params.vnp_SecureHash = hmac(['vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo'].map(key => params[key]).join('|'), config.hashSecret);
  let response;
  try {
    response = await fetch(config.queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(15000) });
  } catch { fail('Không kết nối được VNPAY để kiểm tra giao dịch. Vui lòng thử lại.', 502); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) fail('VNPAY trả kết quả kiểm tra không hợp lệ', 502);
  // Not-found/rate-limit responses carry no trustworthy payment confirmation.
  if (data.vnp_ResponseCode !== '00') {
    if (['91', '94'].includes(data.vnp_ResponseCode)) return { pending: true, code: data.vnp_ResponseCode };
    if (data.vnp_ResponseCode === '99' && config.confirmSandboxReturn) {
      fail('VNPAY sandbox đang lỗi đối soát. Nếu đã thanh toán, hãy quay lại trang kết quả VNPAY và chọn Quay về website để xác nhận. Không thanh toán lại đơn này.', 502);
    }
    fail('VNPAY chưa xử lý được yêu cầu đối soát (mã ' + String(data.vnp_ResponseCode || '99') + '). Vui lòng thử lại sau.', 502);
  }
  const expected = hmac(QUERY_RESPONSE_FIELDS.map(key => data[key] ?? '').join('|'), config.hashSecret);
  if (!validHash(data.vnp_SecureHash, expected) || data.vnp_TmnCode !== config.tmnCode || data.vnp_TxnRef !== attempt.reference || data.vnp_Command !== 'querydr' || data.vnp_TransactionType !== '01') fail('Không xác thực được phản hồi VNPAY', 502);
  if (data.vnp_TransactionStatus === '01') return { pending: true };
  return { params: { ...data, vnp_ResponseCode: data.vnp_TransactionStatus === '00' ? '00' : '99' } };
}
