const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function normalizeDeliveryDate(value) {
  if (value == null || value === '') return null;
  let input = value;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value);
    input = numeric < 1e12 ? numeric * 1000 : numeric;
  } else if (typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) {
    input = value.replace(' ', 'T') + '+07:00';
  } else if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }
  const date = new Date(input);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100
    ? date.toISOString() : null;
}

export function toDeliverySqlDate(value) {
  const iso = normalizeDeliveryDate(value);
  return iso ? new Date(Date.parse(iso) + 7 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') : null;
}

export function shouldRefreshDelivery(order, now = Date.now()) {
  if (!['processing', 'shipped'].includes(order.status) || !order.ghn_order_code) return false;
  if (['cancel', 'delivered', 'returned', 'lost', 'damage'].includes(order.ghn_status)) return false;
  const checked = normalizeDeliveryDate(order.ghn_delivery_checked_at);
  return !checked || now - Date.parse(checked) >= REFRESH_INTERVAL_MS;
}

export function getGhnDeliveryDate(shipment) {
  return normalizeDeliveryDate(shipment?.expected_delivery_time)
    || normalizeDeliveryDate(shipment?.leadtime);
}
