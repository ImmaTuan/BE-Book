import { getVnpayConfig } from '../config/vnpay.js';
import { prepareVnpayPayment } from '../services/order-vnpay.service.js';
import { paymentIp } from '../services/vnpay.service.js';
import { validatePaymentMethod } from '../order-payment.js';
import { refreshOrderDelivery } from '../services/order-delivery.service.js';
import { getGhnDeliveryDate } from '../delivery-estimate.js';
import * as orders from '../models/promotional-order.model.js';
import * as ghn from '../services/ghn.service.js';
import { fail, id, pagination } from '../validation.js';

const orderFields = [
  'recipient_name',
  'recipient_phone',
  'shipping_address',
  'to_ward_name',
  'to_province_name',
  'to_district_name',
  'is_new_to_address',
  'items',
  'order_promotion_code',
  'payment_method',
];

function validateCreateOrder(body, requireGhnAddress) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body phải là JSON object');
  if (Object.keys(body).some((key) => !orderFields.includes(key))) {
    fail('Đơn hàng chỉ nhận thông tin người nhận, địa chỉ giao hàng, items, order_promotion_code và payment_method');
  }

  const paymentMethod = validatePaymentMethod(body.payment_method);
  const recipientName = typeof body.recipient_name === 'string' ? body.recipient_name.trim() : '';
  const recipientPhone = typeof body.recipient_phone === 'string' ? body.recipient_phone.trim() : '';
  const shippingAddress = typeof body.shipping_address === 'string' ? body.shipping_address.trim() : '';
  if (!recipientName || recipientName.length > 255) fail('recipient_name là bắt buộc, tối đa 255 ký tự');
  if (!/^\+?[0-9().\s-]{7,20}$/.test(recipientPhone)) fail('recipient_phone không hợp lệ');
  if (!shippingAddress || shippingAddress.length > 1024) fail('shipping_address là bắt buộc, tối đa 1024 ký tự');
  const wardName = typeof body.to_ward_name === 'string' ? body.to_ward_name.trim() : '';
  const provinceName = typeof body.to_province_name === 'string' ? body.to_province_name.trim() : '';
  const isNewAddress = body.is_new_to_address ?? true;
  const districtName = typeof body.to_district_name === 'string' ? body.to_district_name.trim() : '';
  if (wardName.length > 255) fail('to_ward_name tối đa 255 ký tự');
  if (provinceName.length > 255) fail('to_province_name tối đa 255 ký tự');
  if (districtName.length > 255) fail('to_district_name tối đa 255 ký tự');
  if (requireGhnAddress && (!wardName || wardName.length > 255)) {
    fail('to_ward_name là bắt buộc để tạo vận đơn GHN, tối đa 255 ký tự');
  }
  if (requireGhnAddress && (!provinceName || provinceName.length > 255)) {
    fail('to_province_name là bắt buộc để tạo vận đơn GHN, tối đa 255 ký tự');
  }
  if (typeof isNewAddress !== 'boolean') fail('is_new_to_address phải là boolean');
  if (requireGhnAddress && !isNewAddress && (!districtName || districtName.length > 255)) {
    fail('to_district_name là bắt buộc khi dùng địa chỉ hành chính cũ');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    fail('items phải có từ 1 đến 50 sản phẩm');
  }

  const seenBookIds = new Set();
  const items = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['book_id', 'quantity'].includes(key))) {
      fail('Mỗi sản phẩm chỉ nhận book_id và quantity');
    }
    const bookId = id(item.book_id);
    if (seenBookIds.has(bookId)) fail('Không gửi trùng book_id trong cùng đơn hàng');
    seenBookIds.add(bookId);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      fail('quantity phải là số nguyên từ 1 đến 99');
    }
    return { book_id: bookId, quantity: item.quantity };
  });

  return {
    payment_method: paymentMethod,
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    shipping_address: shippingAddress,
    to_ward_name: wardName,
    to_province_name: provinceName,
    to_district_name: isNewAddress ? null : districtName,
    is_new_to_address: isNewAddress,
    items,
    order_promotion_code: body.order_promotion_code ? String(body.order_promotion_code).trim() : null,
  };
}

function validateQuoteBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['items', 'order_promotion_code'].includes(key))) {
    fail('Quote body only accepts items and order_promotion_code');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    fail('items must contain 1 to 50 books');
  }
  const seen = new Set();
  const items = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['book_id', 'quantity'].includes(key))) {
      fail('Each item only accepts book_id and quantity');
    }
    const bookId = id(item.book_id);
    if (seen.has(bookId)) fail('Duplicate book_id is not allowed');
    seen.add(bookId);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) fail('quantity must be an integer from 1 to 99');
    return { book_id: bookId, quantity: item.quantity };
  });
  const code = body.order_promotion_code == null || body.order_promotion_code === ''
    ? null : String(body.order_promotion_code).trim();
  if (code && code.length > 50) fail('order_promotion_code is too long');
  return { items, code };
}

function validateStatus(status) {
  if (!orders.ORDER_STATUSES.includes(status)) fail('Trạng thái đơn hàng không hợp lệ');
  return status;
}

export async function createOwnOrder(req, res) {
  const ghnEnabled = ghn.isGhnConfigured();
  const input = validateCreateOrder(req.body, ghnEnabled);
  if (input.payment_method === 'vnpay') {
    getVnpayConfig();
    if (!ghnEnabled) fail('Cần cấu hình GHN để xác định phí giao hàng trước khi thanh toán VNPAY', 503);
  }
  let order = await orders.createOrder(req.user.id, input);
  if (input.payment_method === 'vnpay') {
    let payment = null;
    let paymentError = null;
    try { payment = await prepareVnpayPayment(order, req.user.id, paymentIp(req)); }
    catch (error) { paymentError = error.expose || error.status < 500 ? error.message : 'Chưa tạo được liên kết thanh toán. Vui lòng thử lại từ đơn hàng.'; }
    order = await orders.findOrder(order.id);
    return res.status(201).json({ message: 'Đã tạo đơn chờ thanh toán VNPAY', data: order, payment, ...(paymentError ? { payment_error: paymentError } : {}) });
  }
  console.log('New order created', { order_id: order.id, user_id: req.user.id, ghn_enabled: ghnEnabled });
  if (ghnEnabled) {
    try {
      const shipment = await ghn.createGhnShipment(order);
      order = await orders.saveGhnShipment(order.id, shipment);
    } catch (error) {
      await orders.updateGhnStatus(order.id, 'create_failed');
      console.log('Failed to create GHN shipment for order', order.id, error);
      order = await orders.findOrder(order.id);
      order.shipping_error = error.message;
    }
  } else {
    await orders.updateGhnStatus(order.id, 'not_configured');
    order = await orders.findOrder(order.id);
  }
  res.status(201).json({ message: 'Đặt hàng thành công', data: order });
}

export async function quoteOwnOrder(req, res) {
  const { items, code } = validateQuoteBody(req.body);
  const quote = await orders.quoteOrder(req.user.id, items, code);
  res.json({ data: quote });
}

function validateListFilters(query) {
  const values = {};
  const enums = {
    status: orders.ORDER_STATUSES,
    payment_status: ['unpaid', 'paid', 'cancelled', 'failed', 'expired', 'refund_required', 'review_required'],
    payment_method: ['cod', 'vnpay'],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (query[key] === undefined || query[key] === '') continue;
    if (typeof query[key] !== 'string' || !allowed.includes(query[key])) fail('Bộ lọc ' + key + ' không hợp lệ');
    values[key === 'payment_status' ? 'paymentStatus' : key === 'payment_method' ? 'paymentMethod' : key] = query[key];
  }
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 100)) fail('Từ khóa tìm mã đơn tối đa 100 ký tự');
  if (query.search?.trim()) values.search = query.search.trim();
  return values;
}

export async function listOwnOrders(req, res) {
  const page = pagination(req.query);
  const result = await orders.listOrders({ ...page, ...validateListFilters(req.query), userId: req.user.id });
  result.data = await Promise.all(result.data.map((order) => refreshOrderDelivery(order)));
  res.json(result);
}

export async function getOwnOrder(req, res) {
  const order = await orders.findCustomerOrder(id(req.params.id), req.user.id);
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  res.json({ data: await refreshOrderDelivery(order) });
}

export async function listAllOrders(req, res) {
  const page = pagination(req.query);
  const result = await orders.listOrders({ ...page, ...validateListFilters(req.query) });
  res.json(result);
}

export async function getOrder(req, res) {
  const order = await orders.findOrder(id(req.params.id));
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  res.json({ data: order });
}

export async function changeOrderStatus(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => key !== 'status')) {
    fail('Body chỉ nhận trường status');
  }
  const orderId = id(req.params.id);
  const status = validateStatus(req.body.status);
  const current = await orders.findOrder(orderId);
  if (!current) fail('Không tìm thấy đơn hàng', 404);
  if (!orders.canTransitionOrderStatus(current.status, status)) {
    fail(`Không thể chuyển đơn hàng từ ${current.status} sang ${status}`, 409);
  }
  if (current.payment_method === 'vnpay') {
    if (status === 'cancelled' && ['paid', 'refund_required', 'review_required'].includes(current.payment_status)) fail('Đơn VNPAY cần xử lý hoàn tiền hoặc đối soát trước khi hủy', 409);
    if (status !== 'cancelled' && current.payment_status !== 'paid') fail('Đơn VNPAY chưa thanh toán thành công', 409);
  }
  if (status === 'cancelled' && current.ghn_order_code) {
    await ghn.cancelGhnShipment(current.ghn_order_code);
  }
  let order = await orders.updateOrderStatus(orderId, status, {actorId:req.user.id,source:'admin'});
  if (['processing', 'shipped'].includes(status)) order = await refreshOrderDelivery(order, { force: true });
  if (status === 'cancelled' && current.ghn_order_code) {
    await orders.updateGhnStatus(orderId, 'cancel');
  }
  res.json({ message: 'Đã cập nhật trạng thái đơn hàng', data: order });
}

export async function createShipment(req, res) {
  const order = await orders.findOrder(id(req.params.id));
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  if (['cancelled', 'delivered'].includes(order.status)) fail('Đơn hàng đã kết thúc, không thể tạo vận đơn', 409);
  if (!ghn.isGhnConfigured()) fail('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);
  if (order.ghn_order_code) fail('Đơn hàng đã có mã vận đơn GHN', 409);

  try {
    const shipment = await ghn.createGhnShipment(order);
    const updated = await orders.saveGhnShipment(order.id, shipment);
    res.status(201).json({ message: 'Đã tạo vận đơn GHN', data: await refreshOrderDelivery(updated, { force: true }) });
  } catch (error) {
    await orders.updateGhnStatus(order.id, 'create_failed');
    throw error;
  }
}

export async function getShipment(req, res) {
  const order = await orders.findOrder(id(req.params.id));
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  if (!order.ghn_order_code) fail('Đơn hàng chưa có mã vận đơn GHN', 404);
  if (!ghn.isGhnConfigured()) fail('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);
  const shipment = await ghn.getGhnShipment(order.ghn_order_code);
  if (!shipment?.status) fail('GHN không trả trạng thái vận đơn hợp lệ', 502);
  await orders.updateGhnStatus(order.id, shipment.status);
  await orders.saveDeliveryEstimate(order.id, getGhnDeliveryDate(shipment));
  res.json({ data: { local_order: await orders.findOrder(order.id), shipment } });
}
