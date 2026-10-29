import * as orders from '../models/order.model.js';
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
];

function validateCreateOrder(body, requireGhnAddress) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body phải là JSON object');
  if (Object.keys(body).some((key) => !orderFields.includes(key))) {
    fail('Đơn hàng chỉ nhận recipient_name, recipient_phone, shipping_address và items');
  }

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
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    shipping_address: shippingAddress,
    to_ward_name: wardName,
    to_province_name: provinceName,
    to_district_name: isNewAddress ? null : districtName,
    is_new_to_address: isNewAddress,
    items,
  };
}

function validateStatus(status) {
  if (!orders.ORDER_STATUSES.includes(status)) fail('Trạng thái đơn hàng không hợp lệ');
  return status;
}

export async function createOwnOrder(req, res) {
  const ghnEnabled = ghn.isGhnConfigured();
  const input = validateCreateOrder(req.body, ghnEnabled);
  let order = await orders.createOrder(req.user.id, input);
  if (ghnEnabled) {
    try {
      const shipment = await ghn.createGhnShipment(order);
      order = await orders.saveGhnShipment(order.id, shipment);
    } catch (error) {
      await orders.updateGhnStatus(order.id, 'create_failed');
      order = await orders.findOrder(order.id);
      order.shipping_error = error.message;
    }
  } else {
    await orders.updateGhnStatus(order.id, 'not_configured');
    order = await orders.findOrder(order.id);
  }
  res.status(201).json({ message: 'Đặt hàng thành công', data: order });
}

export async function listOwnOrders(req, res) {
  const page = pagination(req.query);
  const result = await orders.listOrders({ ...page, userId: req.user.id });
  res.json(result);
}

export async function getOwnOrder(req, res) {
  const order = await orders.findCustomerOrder(id(req.params.id), req.user.id);
  if (!order) fail('Không tìm thấy đơn hàng', 404);
  res.json({ data: order });
}

export async function listAllOrders(req, res) {
  const page = pagination(req.query);
  const status = req.query.status ? validateStatus(String(req.query.status)) : undefined;
  const result = await orders.listOrders({ ...page, status });
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
  if (status === 'cancelled' && current.ghn_order_code) {
    await ghn.cancelGhnShipment(current.ghn_order_code);
  }
  const order = await orders.updateOrderStatus(orderId, status);
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
    res.status(201).json({ message: 'Đã tạo vận đơn GHN', data: updated });
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
  res.json({ data: { local_order: await orders.findOrder(order.id), shipment } });
}
