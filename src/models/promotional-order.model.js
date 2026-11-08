import { recordOrderEvent } from './order-event.model.js';
import { codPaymentOutcome, validatePaymentMethod } from '../order-payment.js';
import { normalizeDeliveryDate, toDeliverySqlDate } from '../delivery-estimate.js';
import { randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';
import { fail } from '../validation.js';
import { calculateOrderQuote } from '../promotion-pricing.js';

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const allowedNextStatuses = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

function mapOrderRows(order, items, promotions = []) {
  return {
    ...order,
    ghn_expected_delivery_at: normalizeDeliveryDate(order.ghn_expected_delivery_at),
    ghn_delivery_checked_at: normalizeDeliveryDate(order.ghn_delivery_checked_at),
    processing_started_at: normalizeDeliveryDate(order.processing_started_at),
    paid_at: normalizeDeliveryDate(order.paid_at),
    payment_expires_at: normalizeDeliveryDate(order.payment_expires_at),
    expired_at: normalizeDeliveryDate(order.expired_at),
    items, promotion_usages: promotions,
  };
}

async function findOrderItems(orderIds, db = pool) {
  if (!orderIds.length) return [];
  const placeholders = orderIds.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT oi.id, oi.order_id, oi.book_id, oi.book_title, oi.unit_price,
            COALESCE(oi.original_unit_price, oi.unit_price) AS original_unit_price,
            COALESCE(oi.direct_discount_amount, 0) AS direct_discount_amount,
            oi.product_promotion_id, COALESCE(oi.order_discount_amount, 0) AS order_discount_amount,
            oi.quantity, COALESCE(oi.weight_grams, b.weight_grams, 1) AS weight_grams
     FROM order_items oi LEFT JOIN books b ON b.id = oi.book_id
     WHERE oi.order_id IN (${placeholders}) ORDER BY oi.id`, orderIds,
  );
  return rows;
}

async function findPromotionUsages(orderIds, db = pool) {
  if (!orderIds.length) return [];
  const [rows] = await db.execute(
    `SELECT order_id, promotion_id, code_snapshot, name_snapshot, discount_amount, status, used_at
     FROM promotion_usages WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`, orderIds,
  );
  return rows;
}

export async function quoteOrder(userId, items, orderCode = null) {
  return calculateOrderQuote({ items, userId, orderCode });
}

export async function createOrder(userId, input) {
  const paymentMethod = validatePaymentMethod(input.payment_method);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const quote = await calculateOrderQuote({
      items: input.items,
      userId,
      orderCode: input.order_promotion_code,
      db: connection,
      lock: true,
      strictPromotion: true,
    });
    const totalWeight = quote.items.reduce((sum, item) => sum + item.weight_grams * item.quantity, 0);

    for (const item of quote.items) {
      if (!item.product_promotion_id) continue;
      const [reserved] = await connection.execute(
        `UPDATE product_promotion_books SET quantity_used = quantity_used + ?
         WHERE product_promotion_id = ? AND book_id = ? AND is_active = 1
           AND (quantity_limit IS NULL OR quantity_used + ? <= quantity_limit)`,
        [item.quantity, item.product_promotion_id, item.book_id, item.quantity],
      );
      if (!reserved.affectedRows) fail('FLASH_SALE_SOLD_OUT', 409);
    }

    const orderCode = `ORD-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const [created] = await connection.execute(
      `INSERT INTO orders (
        user_id, order_code, recipient_name, recipient_phone, shipping_address,
        subtotal, direct_discount_amount, shipping_fee, total_amount, status, discount_amount, promotion_id,
        ghn_shop_id, to_district_id, to_ward_code, package_weight_grams,
        package_length_cm, package_width_cm, package_height_cm,
        service_type_id, payment_type_id, cod_amount, insurance_value,
        ghn_to_ward_name, ghn_to_province_name, ghn_to_district_name, ghn_is_new_to_address, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, 0, 0, '', ?, 1, 1, 1, 0, 0, ?, 0, ?, ?, ?, ?, ?)`,
      [
        userId, orderCode, input.recipient_name, input.recipient_phone, input.shipping_address,
        quote.subtotal, quote.direct_discount_amount, quote.total_amount, quote.order_discount_amount,
        quote.selected_order_promotion?.id ?? null,
        Math.max(totalWeight, 1), paymentMethod === 'vnpay' ? 0 : quote.total_amount,
        input.to_ward_name ?? '', input.to_province_name ?? '', input.to_district_name ?? null,
        input.is_new_to_address ?? true, paymentMethod,
      ],
    );

    if (paymentMethod === 'vnpay') {
      await connection.execute("UPDATE orders SET payment_expires_at=DATE_ADD(NOW(),INTERVAL 17 MINUTE) WHERE id=?", [created.insertId]);
    }
    for (const item of quote.items) {
      await connection.execute(
        `INSERT INTO order_items (order_id, book_id, book_title, unit_price, original_unit_price,
          direct_discount_amount, product_promotion_id, order_discount_amount, quantity, weight_grams)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, item.book_id, item.book_title, item.unit_price, item.original_unit_price,
          item.direct_discount_amount, item.product_promotion_id, item.order_discount_amount,
          item.quantity, item.weight_grams],
      );
      const [stock] = await connection.execute(
        'UPDATE books SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
        [item.quantity, item.book_id, item.quantity],
      );
      if (!stock.affectedRows) fail(`BOOK_STOCK_INSUFFICIENT:${item.book_id}`, 409);
    }

    if (quote.selected_order_promotion) {
      const promotion = quote.selected_order_promotion;
      const [claimed] = await connection.execute(
        `UPDATE promotions SET usage_count = usage_count + 1
         WHERE id = ? AND kind = 'order'
           AND (total_usage_limit IS NULL OR usage_count < total_usage_limit)`, [promotion.id],
      );
      if (!claimed.affectedRows) fail('USAGE_LIMIT_REACHED', 409);
      await connection.execute(
        `INSERT INTO promotion_usages
         (promotion_id, order_id, user_id, code_snapshot, name_snapshot, discount_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'reserved')`,
        [promotion.id, created.insertId, userId, promotion.code, promotion.name, quote.order_discount_amount],
      );
    }

    await recordOrderEvent(connection, {id:created.insertId,user_id:userId,order_code:orderCode}, {type:'order_created',to:'pending',source:'customer',actorId:userId,key:'created'});
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

export async function listOrders({ page, limit, offset, userId, status, paymentStatus, paymentMethod, search }) {
  const filters = [];
  const values = [];
  if (userId !== undefined) { filters.push('user_id = ?'); values.push(userId); }
  if (status) { filters.push('status = ?'); values.push(status); }
  if (paymentStatus) { filters.push('payment_status = ?'); values.push(paymentStatus); }
  if (paymentMethod) { filters.push('payment_method = ?'); values.push(paymentMethod); }
  if (search) { filters.push('LOCATE(?, order_code) > 0'); values.push(search); }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM orders${where}`, values);
  const [orders] = await pool.execute(
    `SELECT id, user_id, order_code, recipient_name, recipient_phone, shipping_address,
            subtotal, direct_discount_amount, discount_amount, shipping_fee, total_amount,
            status, payment_method, payment_status, paid_at, payment_expires_at, expired_at, created_at, ghn_expected_delivery_at, ghn_delivery_checked_at, processing_started_at, ghn_order_code, ghn_status
     FROM orders${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, values,
  );
  const items = await findOrderItems(orders.map((order) => order.id));
  const uses = await findPromotionUsages(orders.map((order) => order.id));
  const itemsByOrder = new Map();
  const usesByOrder = new Map();
  for (const item of items) {
    const orderItems = itemsByOrder.get(item.order_id) ?? [];
    orderItems.push(item); itemsByOrder.set(item.order_id, orderItems);
  }
  for (const use of uses) {
    const orderUses = usesByOrder.get(use.order_id) ?? [];
    orderUses.push(use); usesByOrder.set(use.order_id, orderUses);
  }
  return {
    data: orders.map((order) => mapOrderRows(order, itemsByOrder.get(order.id) ?? [], usesByOrder.get(order.id) ?? [])),
    meta: { page, limit, total: count.total },
  };
}

export async function findOrder(orderId, db = pool) {
  const [rows] = await db.execute(
    `SELECT id, user_id, order_code, recipient_name, recipient_phone, shipping_address,
            subtotal, direct_discount_amount, discount_amount, shipping_fee, total_amount,
            status, payment_method, payment_status, paid_at, payment_expires_at, expired_at, created_at, ghn_expected_delivery_at, ghn_delivery_checked_at, processing_started_at, ghn_order_code, ghn_status, package_weight_grams,
            ghn_to_ward_name, ghn_to_province_name, ghn_to_district_name, ghn_is_new_to_address,
            cod_amount
     FROM orders WHERE id = ?`, [orderId],
  );
  if (!rows[0]) return undefined;
  const [items, uses] = await Promise.all([
    findOrderItems([orderId], db),
    findPromotionUsages([orderId], db),
  ]);
  return mapOrderRows(rows[0], items, uses);
}

export async function saveGhnShipment(orderId, shipment) {
  const db=await pool.getConnection();
  try {
  await db.beginTransaction();
  const [[current]]=await db.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);
  if(!current)fail('Không tìm thấy đơn hàng',404);
  const buyerPaysShipping = shipment.paymentTypeId === 2;
  await db.execute(
    `UPDATE orders SET ghn_order_code = ?, ghn_status = ?, shipping_fee = IF(payment_method = 'vnpay', shipping_fee, ?),
       total_amount = IF(payment_method = 'vnpay', total_amount, subtotal - discount_amount + ?), ghn_shop_id = ?, service_type_id = ?,
       payment_type_id = ?, package_length_cm = ?, package_width_cm = ?, package_height_cm = ?,
       ghn_expected_delivery_at = ?, ghn_delivery_checked_at = NOW()
     WHERE id = ?`,
    [shipment.orderCode, shipment.status, shipment.fee, buyerPaysShipping ? shipment.fee : 0,
      shipment.shopId, shipment.serviceTypeId, shipment.paymentTypeId, shipment.length,
      shipment.width, shipment.height, toDeliverySqlDate(shipment.expectedDeliveryTime), orderId],
  );
  await recordOrderEvent(db,current,{type:'shipment_created',source:'ghn',to:shipment.status,detail:'Mã vận đơn: '+shipment.orderCode,key:'shipment:'+shipment.orderCode});
  const updated=await findOrder(orderId,db);
  await db.commit();return updated;
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}

export async function saveDeliveryEstimate(orderId, expectedAt) {
  await pool.execute(
    'UPDATE orders SET ghn_expected_delivery_at = COALESCE(?, ghn_expected_delivery_at), ghn_delivery_checked_at = NOW() WHERE id = ?',
    [toDeliverySqlDate(expectedAt), orderId],
  );
}

// Restrict transitions to unpaid COD orders. Repeated delivery/cancel events do
// not reset paid_at or turn a collected payment into a cancellation/refund.
async function updateCodPayment(db, column, value, status, order, source='ghn') {
  const outcome = codPaymentOutcome(status);
  if (!outcome) return;
  const [result]=await db.execute(
    `UPDATE orders SET paid_at = IF(? = 'paid', COALESCE(paid_at, NOW()), paid_at),
       payment_status = ? WHERE ${column} = ? AND payment_method = 'cod' AND payment_status = 'unpaid'`,
    [outcome, outcome, value],
  );
  if(result.affectedRows && outcome==='paid') await recordOrderEvent(db,order,{type:'payment_paid',source,to:'paid'});
}

async function updateShippingStatus(column,value,status) {
 const db=await pool.getConnection();
 try{
  await db.beginTransaction();
  const [[order]]=await db.execute('SELECT * FROM orders WHERE '+column+'=? FOR UPDATE',[value]);
  if(!order){await db.commit();return;}
  const next=String(status).slice(0,50);
  if(order.ghn_status!==next){
   await db.execute('UPDATE orders SET ghn_status=?,ghn_delivery_checked_at=NULL WHERE id=?',[next,order.id]);
   await recordOrderEvent(db,order,{type:'shipping_status',source:'ghn',from:order.ghn_status,to:next});
  }
  await updateCodPayment(db,'id',order.id,next,order);
  await db.commit();
 }catch(error){await db.rollback();throw error;}finally{db.release();}
}
export async function updateGhnStatus(orderId,status){return updateShippingStatus('id',orderId,status);}
export async function updateGhnStatusByCode(orderCode,status){return updateShippingStatus('ghn_order_code',orderCode,status);}

export async function findCustomerOrder(orderId, userId) {
  const order = await findOrder(orderId);
  if (!order || order.user_id !== userId) return undefined;
  return order;
}

export async function updateOrderStatus(orderId, nextStatus, { actorId=null, source='admin', expire=false }={}) {
  if (!ORDER_STATUSES.includes(nextStatus)) fail('Trạng thái đơn hàng không hợp lệ');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT *, (payment_expires_at<=NOW()) AS payment_overdue FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order) fail('Không tìm thấy đơn hàng', 404);
    if(expire){
      if(order.payment_method!=='vnpay'||order.status!=='pending'||!['unpaid','failed'].includes(order.payment_status)||!order.payment_overdue||order.ghn_order_code)fail('Đơn không còn đủ điều kiện hết hạn',409);
      const [[active]]=await connection.execute("SELECT COUNT(*) AS count FROM vnpay_payments WHERE order_id=? AND status IN ('pending','review')",[orderId]);
      if(Number(active.count)>0)fail('Giao dịch còn chờ đối soát',409);
    }
    if (order.payment_method === 'vnpay') {
      if (nextStatus === 'cancelled' && ['paid', 'refund_required', 'review_required'].includes(order.payment_status)) {
        fail('Đơn VNPAY đã thu tiền hoặc cần đối soát; cần xử lý hoàn tiền trước khi hủy', 409);
      }
      if (nextStatus !== 'cancelled' && order.payment_status !== 'paid') fail('Đơn VNPAY chưa thanh toán thành công', 409);
    }
    if (!canTransitionOrderStatus(order.status, nextStatus)) fail(`Không thể chuyển đơn hàng từ ${order.status} sang ${nextStatus}`, 409);
    await connection.execute(
      "UPDATE orders SET status = ?, processing_started_at = IF(? = 'processing', COALESCE(processing_started_at, NOW()), processing_started_at) WHERE id = ?",
      [nextStatus, nextStatus, orderId],
    );
    await updateCodPayment(connection, 'id', orderId, nextStatus, order, source);
    if (nextStatus === 'cancelled' && order.payment_method === 'vnpay') {
      await connection.execute("UPDATE orders SET payment_status = 'cancelled' WHERE id = ? AND payment_method = 'vnpay' AND payment_status IN ('unpaid', 'failed')", [orderId]);
    }
    if (nextStatus === 'cancelled') {
      await connection.execute(
        `UPDATE books b JOIN order_items oi ON oi.book_id = b.id
         SET b.stock_quantity = b.stock_quantity + oi.quantity WHERE oi.order_id = ?`, [orderId],
      );
      await connection.execute(
        `UPDATE product_promotion_books ppb
         JOIN order_items oi ON oi.product_promotion_id = ppb.product_promotion_id AND oi.book_id = ppb.book_id
         SET ppb.quantity_used = GREATEST(0, ppb.quantity_used - oi.quantity)
         WHERE oi.order_id = ? AND oi.product_promotion_id IS NOT NULL`, [orderId],
      );
      const [usages] = await connection.execute(
        `SELECT promotion_id FROM promotion_usages WHERE order_id = ? AND status = 'reserved' FOR UPDATE`, [orderId],
      );
      for (const usage of usages) {
        await connection.execute(
          `UPDATE promotion_usages SET status = 'released', released_at = UTC_TIMESTAMP()
           WHERE order_id = ? AND promotion_id = ? AND status = 'reserved'`, [orderId, usage.promotion_id],
        );
        await connection.execute('UPDATE promotions SET usage_count = GREATEST(0, usage_count - 1) WHERE id = ?', [usage.promotion_id]);
      }
    } else if (nextStatus === 'delivered') {
      await connection.execute("UPDATE promotion_usages SET status = 'used' WHERE order_id = ? AND status = 'reserved'", [orderId]);
    }
    if(expire)await connection.execute("UPDATE orders SET payment_status='expired',expired_at=NOW() WHERE id=?",[orderId]);
    await recordOrderEvent(connection,order,{type:expire?'payment_expired':'order_status',source,actorId,from:order.status,to:nextStatus,detail:expire?'Đơn hết hạn thanh toán; đã hoàn tồn kho và lượt dùng ưu đãi':null,key:expire?'payment_expired':null});
    const updated = await findOrder(orderId, connection);
    await connection.commit();
    return updated;
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
