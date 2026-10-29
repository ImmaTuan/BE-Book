import { timingSafeEqual } from 'node:crypto';
import * as orders from '../models/order.model.js';
import { getGhnConfig } from '../config/ghn.js';
import { fail } from '../validation.js';

export async function receiveOrderStatus(req, res) {
  const expectedSecret = process.env.GHN_WEBHOOK_SECRET || '';
  if (!expectedSecret) fail('GHN webhook chưa được cấu hình', 503);

  const suppliedSecret = req.get('x-ghn-webhook-secret') || '';
  const expectedBuffer = Buffer.from(expectedSecret);
  const suppliedBuffer = Buffer.from(suppliedSecret);
  if (expectedBuffer.length !== suppliedBuffer.length
    || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ message: 'Webhook secret không hợp lệ' });
  }

  const config = getGhnConfig();
  if (!config) fail('GHN chưa được cấu hình', 503);
  const event = req.body;
  if (!event || String(event.ShopID) !== config.shopId
    || typeof event.OrderCode !== 'string' || !event.OrderCode
    || typeof event.Status !== 'string' || !event.Status) {
    fail('Payload webhook GHN không hợp lệ', 400);
  }

  await orders.updateGhnStatusByCode(event.OrderCode, event.Status);
  res.status(200).json({ received: true });
}
