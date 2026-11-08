import 'dotenv/config';
import { fail } from '../validation.js';

export function getVnpayConfig() {
  const tmnCode = (process.env.VNP_TMN_CODE || process.env.VNPAY_TMN_CODE || process.env.vnp_TmnCode || '').trim();
  const hashSecret = (process.env.VNP_HASH_SECRET || process.env.VNPAY_HASH_SECRET || process.env.vnp_HashSecret || '').trim();
  if (!tmnCode || !hashSecret) fail('Chưa cấu hình vnp_TmnCode và vnp_HashSecret', 503);
  const paymentUrl = process.env.VNP_URL || process.env.VNPAY_URL || process.env.vnp_Url || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  if (!['https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', 'https://pay.vnpay.vn/vpcpay.html'].includes(paymentUrl)) fail('URL thanh toán VNPAY không hợp lệ', 503);
  const frontendUrl = process.env.VNP_FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
  const returnUrl = process.env.VNP_RETURN_URL || process.env.vnp_ReturnUrl || 'http://localhost:' + (process.env.PORT || 3000) + '/api/payments/vnpay/return';
  for (const address of [frontendUrl, returnUrl]) {
    let url;
    try { url = new URL(address); } catch { fail('URL trả kết quả VNPAY không hợp lệ', 503); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('URL trả kết quả VNPAY không hợp lệ', 503);
  }
  const confirmSandboxReturn = process.env.VNP_LOCAL_RETURN_CONFIRM === 'true';
  if (confirmSandboxReturn && (!paymentUrl.includes('sandbox.vnpayment.vn') || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(returnUrl).hostname))) {
    fail('VNP_LOCAL_RETURN_CONFIRM chỉ được dùng cho VNPAY sandbox tại localhost', 503);
  }
  return {
    tmnCode, hashSecret, paymentUrl, frontendUrl, returnUrl, confirmSandboxReturn,
    queryUrl: paymentUrl.includes('sandbox.') ? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction' : 'https://merchant.vnpay.vn/merchant_webapi/api/transaction',
  };
}
