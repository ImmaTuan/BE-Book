import { getCodAmount } from '../order-payment.js';
import { getGhnDeliveryDate } from '../delivery-estimate.js';
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

// Resolve the pickup address from the configured shop, independently of the recipient.
// Some GHN shop records contain whitespace in ward_code; implicit shop defaults
// then fail validation even though the ward exists in GHN master data.
async function getGhnSenderAddress(setup) {
  const { data } = await requestGhn('/shiip/public-api/v2/shop/all');
  const shop = data?.shops?.find((entry) => String(entry._id) === setup.shopId);
  if (!shop) {
    throw makeGhnError('Không tìm thấy GHN_SHOP_ID trong tài khoản GHN; kiểm tra ShopId, token và môi trường API', 503);
  }

  if (shop.is_new_address === true) {
    return { is_new_from_address: true };
  }

  const districtId = Number(shop.district_id);
  const wardCode = String(shop.ward_code ?? '').trim();
  if (!Number.isInteger(districtId) || districtId < 1 || !wardCode) {
    throw makeGhnError('Shop GHN thiếu mã quận/huyện hoặc phường/xã người gửi; cập nhật địa chỉ lấy hàng trên GHN', 503);
  }
  const districts = await getCachedMasterData(
    'sender:districts', '/shiip/public-api/master-data/district',
  );
  const district = districts?.find((entry) => Number(entry.DistrictID) === districtId);
  const wards = await getCachedMasterData(
    `sender:wards:${districtId}`,
    `/shiip/public-api/master-data/ward?district_id=${districtId}`,
  );
  const ward = wards?.find((entry) => String(entry.WardCode).trim() === wardCode);
  const provinces = await getCachedMasterData(
    'sender:provinces', '/shiip/public-api/master-data/province',
  );
  const province = provinces?.find((entry) => Number(entry.ProvinceID) === Number(district?.ProvinceID));
  if (!ward?.WardName || !district?.DistrictName || !province?.ProvinceName) {
    throw makeGhnError('Địa chỉ người gửi của shop GHN không còn hợp lệ; cập nhật phường/xã, quận/huyện và tỉnh/thành lấy hàng trên GHN', 503);
  }

  return {
    is_new_from_address: false,
    from_ward_name: ward.WardName.trim(),
    from_district_name: district.DistrictName.trim(),
    from_province_name: province.ProvinceName.trim(),
  };
}

async function buildGhnPayload(order) {
  const codAmount = getCodAmount(order);
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
    ...await getGhnSenderAddress(setup),
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
    payment_type_id: order.payment_method === 'vnpay' ? 1 : setup.paymentTypeId,
    required_note: setup.requiredNote,
    content: order.items.map((item) => `${item.book_title} x${item.quantity}`).join(', ').slice(0, 2000),
    cod_amount: codAmount,
    order_value: Math.round(Number(order.subtotal)),
    insurance_value: Math.min(5000000, Math.round(Number(order.subtotal))),
    items,
  };

  return { setup, serviceTypeId, payload };
}

export async function previewGhnShipment(order) {
  const { payload } = await buildGhnPayload(order);
  const result = await requestGhn('/shiip/public-api/v2/shipping-order/preview', { method: 'POST', body: payload });
  const fee = Number(result.data?.total_fee ?? result.data?.fee?.total_fee);
  if (!Number.isFinite(fee) || fee < 0) throw makeGhnError('GHN không trả phí giao hàng hợp lệ');
  return { fee: Math.round(fee) };
}

export async function createGhnShipment(order) {
  if (order.payment_method === 'vnpay' && order.payment_status !== 'paid') {
    throw makeGhnError('Đơn VNPAY cần thanh toán thành công trước khi tạo vận đơn', 409);
  }
  const { setup, serviceTypeId, payload } = await buildGhnPayload(order);
  const result = await requestGhn('/shiip/public-api/v2/shipping-order/create', {
    method: 'POST',
    body: payload,
  });
  if (!result?.data?.order_code) throw makeGhnError('GHN không trả mã vận đơn');

  return {
    orderCode: result.data.order_code,
    status: result.data.status || 'ready_to_pick',
    fee: Number(result.data.total_fee ?? result.data.fee?.total_fee ?? 0),
    expectedDeliveryTime: getGhnDeliveryDate(result.data),
    shopId: Number(setup.shopId),
    serviceTypeId,
    paymentTypeId: payload.payment_type_id,
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
