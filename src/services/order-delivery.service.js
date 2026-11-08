import * as orders from '../models/promotional-order.model.js';
import * as ghn from './ghn.service.js';
import { getGhnDeliveryDate, normalizeDeliveryDate, shouldRefreshDelivery } from '../delivery-estimate.js';

const inFlight = new Map();

// Use GHN's estimate for this existing shipment. Never add a guessed number of
// days to confirmation/preparation time or move an expired estimate forward.
export async function refreshOrderDelivery(order, { force = false } = {}) {
  if (!shouldRefreshDelivery({ ...order, ...(force ? { ghn_delivery_checked_at: null } : {}) })) return order;
  if (!ghn.isGhnConfigured()) return order;
  if (inFlight.has(order.id)) {
    const fields = await inFlight.get(order.id);
    return { ...order, ...fields };
  }
  const pending = (async () => {
    let estimate = null;
    let paymentFields = {};
    try {
      const shipment = await ghn.getGhnShipment(order.ghn_order_code);
      estimate = getGhnDeliveryDate(shipment);
      if (['delivered', 'cancel', 'returned'].includes(shipment?.status)) {
        await orders.updateGhnStatus(order.id, shipment.status);
        const current = await orders.findOrder(order.id);
        paymentFields = {
          ghn_status: shipment.status,
          payment_method: current.payment_method,
          payment_status: current.payment_status,
          paid_at: current.paid_at,
        };
      }
    } catch (error) {
      console.warn('Could not refresh GHN delivery estimate', { order_id: order.id, message: error.message });
    }
    // A failed lookup keeps the last known date and records the attempt to avoid
    // hitting GHN on every customer refresh while GHN is unavailable.
    await orders.saveDeliveryEstimate(order.id, estimate);
    return {
      ...paymentFields,
      ghn_expected_delivery_at: estimate || normalizeDeliveryDate(order.ghn_expected_delivery_at),
      ghn_delivery_checked_at: new Date().toISOString(),
    };
  })();
  inFlight.set(order.id, pending);
  try {
    return { ...order, ...await pending };
  } finally {
    inFlight.delete(order.id);
  }
}
