import { fail } from './validation.js';

export function validatePaymentMethod(value = 'cod') {
  if (!['cod', 'vnpay'].includes(value)) fail('payment_method chỉ nhận cod hoặc vnpay');
  return value;
}

export function getCodAmount(order) {
  validatePaymentMethod(order.payment_method);
  if (order.payment_method === 'vnpay') return 0;
  // GHN collects its delivery fee separately when payment_type_id = 2.
  const amount = Math.round(Number(order.subtotal) - Number(order.discount_amount || 0));
  if (!Number.isFinite(amount) || amount < 0 || amount > 50000000) fail('Số tiền thu hộ COD không hợp lệ', 400);
  return amount;
}

export function codPaymentOutcome(status) {
  if (status === 'delivered') return 'paid';
  if (['cancelled', 'cancel', 'returned'].includes(status)) return 'cancelled';
  return null;
}
