import { getGhnConfig } from '../config/ghn.js';

const masterDataCache = new Map();
const masterDataTtl = 60 * 60 * 1000;

function makeGhnError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

async function requestGhn(path, { method = 'GET', body } = {}) {
  const config = getGhnConfig();
  if (!config) throw makeGhnError('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);

  let response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Token: config.token,
        ShopId: config.shopId,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw makeGhnError(error.name === 'TimeoutError' ? 'GHN phản hồi quá thời gian chờ' : 'Không kết nối được GHN');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw makeGhnError('GHN trả về phản hồi không hợp lệ');
  }

  if (!response.ok || result.code !== 200) {
    throw makeGhnError(result.message || 'GHN từ chối yêu cầu');
  }
  return { config, data: result.data };
}

export function isGhnConfigured() {
  return getGhnConfig() !== null;
}

export async function createGhnShipment(order) {
  const setup = getGhnConfig();
  if (!setup) throw makeGhnError('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);
  const weight = Math.max(Number(order.package_weight_grams), 1);
  if (weight > 50000) throw makeGhnError('GHN chỉ nhận kiện hàng tối đa 50.000 gram', 400);
  const serviceTypeId = weight >= 20000 ? 5 : setup.serviceTypeId;

  const items = order.items.map((item) => ({
    name: item.book_title.slice(0, 512),
    code: String(item.book_id),
    quantity: item.quantity,
    price: Math.round(Number(item.unit_price)),
    ...(serviceTypeId === 5 ? {
      length: setup.itemLength,
      width: setup.itemWidth,
      height: setup.itemHeight,
      weight: Math.max(1, Number(item.weight_grams)),
    } : {}),
  }));

  const payload = {
    client_order_code: order.order_code,
    to_name: order.recipient_name,
    to_phone: order.recipient_phone,
    to_address: order.shipping_address,
    to_ward_name: order.ghn_to_ward_name,
    to_province_name: order.ghn_to_province_name,
    is_new_to_address: Boolean(order.ghn_is_new_to_address),
    ...(order.ghn_is_new_to_address ? {} : { to_district_name: order.ghn_to_district_name }),
    weight,
    length: setup.length,
    width: setup.width,
    height: setup.height,
    service_type_id: serviceTypeId,
    payment_type_id: setup.paymentTypeId,
    required_note: setup.requiredNote,
    content: order.items.map((item) => `${item.book_title} x${item.quantity}`).join(', ').slice(0, 2000),
    cod_amount: Math.round(Number(order.cod_amount)),
    order_value: Math.round(Number(order.subtotal)),
    insurance_value: Math.min(5000000, Math.round(Number(order.subtotal))),
    items,
  };

  const result = await requestGhn('/shiip/public-api/v2/shipping-order/create', {
    method: 'POST',
    body: payload,
  });
  if (!result?.data?.order_code) throw makeGhnError('GHN không trả mã vận đơn');

  return {
    orderCode: result.data.order_code,
    status: result.data.status || 'ready_to_pick',
    fee: Number(result.data.total_fee ?? result.data.fee?.total_fee ?? 0),
    expectedDeliveryTime: result.data.expected_delivery_time || null,
    shopId: Number(setup.shopId),
    serviceTypeId,
    paymentTypeId: setup.paymentTypeId,
    length: setup.length,
    width: setup.width,
    height: setup.height,
  };
}

export async function cancelGhnShipment(orderCode) {
  const result = await requestGhn('/shiip/public-api/v2/switch-status/cancel', {
    method: 'POST',
    body: { order_codes: [orderCode], reason_code: 'GHN-CO003' },
  });
  const outcome = result?.data?.[0];
  if (!outcome?.result) throw makeGhnError(outcome?.message || 'GHN không thể hủy vận đơn', 409);
  return outcome;
}

export async function getGhnShipment(orderCode) {
  const result = await requestGhn(
    `/shiip/public-api/v2/shipping-order/detail?order_code=${encodeURIComponent(orderCode)}`,
  );
  return result?.data;
}

async function getCachedMasterData(key, path) {
  const cached = masterDataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const result = await requestGhn(path);
  const data = result?.data ?? null;
  if (masterDataCache.size >= 100) masterDataCache.delete(masterDataCache.keys().next().value);
  masterDataCache.set(key, { data, expiresAt: Date.now() + masterDataTtl });
  return data;
}

export function getGhnProvinces() {
  return getCachedMasterData('provinces', '/shiip/public-api/v3/master-data/province/all?offset=0&limit=200');
}

export function getGhnWards(provinceId) {
  return getCachedMasterData(
    `wards:${provinceId}`,
    `/shiip/public-api/v3/master-data/ward/all-by-province-id?province_id=${provinceId}&offset=0&limit=200`,
  );
}
