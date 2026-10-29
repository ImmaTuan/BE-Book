import { randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { fail } from '../validation.js';

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const allowedNextStatuses = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

function mapOrderRows(order, items) {
  return { ...order, items };
}

async function findOrderItems(orderIds, db = pool) {
  if (!orderIds.length) return [];
  const placeholders = orderIds.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT oi.id, oi.order_id, oi.book_id, oi.book_title, oi.unit_price, oi.quantity,
            COALESCE(oi.weight_grams, b.weight_grams, 1) AS weight_grams
     FROM order_items AS oi
     LEFT JOIN books AS b ON b.id = oi.book_id
     WHERE oi.order_id IN (${placeholders}) ORDER BY oi.id`,
    orderIds,
  );
  return rows;
}

export async function createOrder(userId, input) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const requestedItems = [...input.items].sort((a, b) => a.book_id - b.book_id);
    const orderItems = [];
    let subtotal = 0;
    let totalWeight = 0;

    for (const requested of requestedItems) {
      const [rows] = await connection.execute(
        `SELECT id, title, price, stock_quantity, weight_grams
         FROM books WHERE id = ? AND is_active = 1 FOR UPDATE`,
        [requested.book_id],
      );
      const book = rows[0];
      if (!book) fail(`Không tìm thấy sách đang bán (id ${requested.book_id})`, 404);
      if (book.stock_quantity < requested.quantity) {
        fail(`Sách "${book.title}" không đủ tồn kho`, 409);
      }

      const unitPrice = Number(book.price);
      subtotal += unitPrice * requested.quantity;
      totalWeight += book.weight_grams * requested.quantity;
      orderItems.push({
        book_id: book.id,
        book_title: book.title,
        unit_price: unitPrice,
        quantity: requested.quantity,
        weight_grams: book.weight_grams,
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    const orderCode = `ORD-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const [created] = await connection.execute(
      `INSERT INTO orders (
        user_id, order_code, recipient_name, recipient_phone, shipping_address,
        subtotal, shipping_fee, total_amount, status, discount_amount,
        ghn_shop_id, to_district_id, to_ward_code, package_weight_grams,
        package_length_cm, package_width_cm, package_height_cm,
        service_type_id, payment_type_id, cod_amount, insurance_value,
        ghn_to_ward_name, ghn_to_province_name, ghn_to_district_name, ghn_is_new_to_address
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', 0, 0, 0, '', ?, 1, 1, 1, 0, 0, ?, 0, ?, ?, ?, ?)`,
      [
        userId,
        orderCode,
        input.recipient_name,
        input.recipient_phone,
        input.shipping_address,
        subtotal,
        subtotal,
        Math.max(totalWeight, 1),
        subtotal,
        input.to_ward_name,
        input.to_province_name,
        input.to_district_name,
        input.is_new_to_address,
      ],
    );

    for (const item of orderItems) {
      await connection.execute(
        `INSERT INTO order_items (order_id, book_id, book_title, unit_price, quantity, weight_grams)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [created.insertId, item.book_id, item.book_title, item.unit_price, item.quantity, item.weight_grams],
      );
      await connection.execute(
        'UPDATE books SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
        [item.quantity, item.book_id, item.quantity],
      );
    }

    const order = await findOrder(created.insertId, connection);
    await connection.commit();
    return order;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listOrders({ page, limit, offset, userId, status }) {
  const filters = [];
  const values = [];
  if (userId !== undefined) {
    filters.push('user_id = ?');
    values.push(userId);
  }
  if (status) {
    filters.push('status = ?');
    values.push(status);
  }

  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM orders${where}`, values);
  const [orders] = await pool.execute(
    `SELECT id, user_id, order_code, recipient_name, recipient_phone, shipping_address,
            subtotal, shipping_fee, total_amount, status, created_at, ghn_order_code, ghn_status
     FROM orders${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const items = await findOrderItems(orders.map((order) => order.id));
  const itemsByOrder = new Map();
  for (const item of items) {
    const orderItems = itemsByOrder.get(item.order_id) ?? [];
    orderItems.push(item);
    itemsByOrder.set(item.order_id, orderItems);
  }

  return {
    data: orders.map((order) => mapOrderRows(order, itemsByOrder.get(order.id) ?? [])),
    meta: { page, limit, total: count.total },
  };
}

export async function findOrder(orderId, db = pool) {
  const [rows] = await db.execute(
    `SELECT id, user_id, order_code, recipient_name, recipient_phone, shipping_address,
            subtotal, shipping_fee, total_amount, status, created_at, ghn_order_code, ghn_status,
            package_weight_grams,
            ghn_to_ward_name, ghn_to_province_name, ghn_to_district_name, ghn_is_new_to_address,
            cod_amount
     FROM orders WHERE id = ?`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return undefined;
  const items = await findOrderItems([orderId], db);
  return mapOrderRows(order, items);
}

export async function saveGhnShipment(orderId, shipment) {
  const buyerPaysShipping = shipment.paymentTypeId === 2;
  await pool.execute(
    `UPDATE orders
     SET ghn_order_code = ?, ghn_status = ?, shipping_fee = ?,
         total_amount = subtotal + ?, ghn_shop_id = ?, service_type_id = ?,
         payment_type_id = ?, package_length_cm = ?, package_width_cm = ?, package_height_cm = ?
     WHERE id = ?`,
    [
      shipment.orderCode,
      shipment.status,
      shipment.fee,
      buyerPaysShipping ? shipment.fee : 0,
      shipment.shopId,
      shipment.serviceTypeId,
      shipment.paymentTypeId,
      shipment.length,
      shipment.width,
      shipment.height,
      orderId,
    ],
  );
  return findOrder(orderId);
}

export async function updateGhnStatus(orderId, status) {
  await pool.execute('UPDATE orders SET ghn_status = ? WHERE id = ?', [String(status).slice(0, 50), orderId]);
}

export async function updateGhnStatusByCode(orderCode, status) {
  await pool.execute(
    'UPDATE orders SET ghn_status = ? WHERE ghn_order_code = ?',
    [String(status).slice(0, 50), orderCode],
  );
}

export async function findCustomerOrder(orderId, userId) {
  const order = await findOrder(orderId);
  if (!order || order.user_id !== userId) return undefined;
  return order;
}

export async function updateOrderStatus(orderId, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) fail('Trạng thái đơn hàng không hợp lệ');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, status FROM orders WHERE id = ? FOR UPDATE',
      [orderId],
    );
    const order = rows[0];
    if (!order) fail('Không tìm thấy đơn hàng', 404);

    if (!canTransitionOrderStatus(order.status, nextStatus)) {
      fail(`Không thể chuyển đơn hàng từ ${order.status} sang ${nextStatus}`, 409);
    }

    await connection.execute('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, orderId]);
    if (nextStatus === 'cancelled') {
      await connection.execute(
        `UPDATE books AS b
         JOIN order_items AS oi ON oi.book_id = b.id
         SET b.stock_quantity = b.stock_quantity + oi.quantity
         WHERE oi.order_id = ?`,
        [orderId],
      );
    }

    const updatedOrder = await findOrder(orderId, connection);
    await connection.commit();
    return updatedOrder;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export { ORDER_STATUSES };

export function canTransitionOrderStatus(currentStatus, nextStatus) {
  return Boolean(allowedNextStatuses[currentStatus]?.includes(nextStatus));
}
