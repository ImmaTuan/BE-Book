import 'dotenv/config';

export function getGhnConfig() {
  const token = process.env.GHN_TOKEN?.trim();
  const shopId = process.env.GHN_SHOP_ID?.trim();
  if (!token && !shopId) return null;
  if (!token || !shopId || !/^\d+$/.test(shopId)) {
    const error = new Error('Cấu hình GHN cần đủ GHN_TOKEN và GHN_SHOP_ID dạng số');
    error.status = 503;
    error.expose = true;
    throw error;
  }

  const apiUrl = (process.env.GHN_API_URL || 'https://online-gateway.ghn.vn').replace(/\/$/, '');
  if (!['https://online-gateway.ghn.vn', 'https://dev-online-gateway.ghn.vn'].includes(apiUrl)) {
    const error = new Error('GHN_API_URL phải là production hoặc staging endpoint của GHN');
    error.status = 500;
    error.expose = true;
    throw error;
  }

  const serviceTypeId = Number(process.env.GHN_SERVICE_TYPE_ID || 2);
  const paymentTypeId = Number(process.env.GHN_PAYMENT_TYPE_ID || 1);
  if (![2, 5].includes(serviceTypeId) || ![1, 2].includes(paymentTypeId)) {
    const error = new Error('GHN_SERVICE_TYPE_ID chỉ nhận 2/5 và GHN_PAYMENT_TYPE_ID chỉ nhận 1/2');
    error.status = 500;
    error.expose = true;
    throw error;
  }

  const requiredNote = process.env.GHN_REQUIRED_NOTE || 'CHOXEMHANGKHONGTHU';
  if (!['KHONGCHOXEMHANG', 'CHOXEMHANGKHONGTHU', 'CHOTHUHANG'].includes(requiredNote)) {
    const error = new Error('GHN_REQUIRED_NOTE không hợp lệ');
    error.status = 500;
    error.expose = true;
    throw error;
  }

  const dimensions = [
    Number(process.env.GHN_PACKAGE_LENGTH_CM || 20),
    Number(process.env.GHN_PACKAGE_WIDTH_CM || 15),
    Number(process.env.GHN_PACKAGE_HEIGHT_CM || 10),
    Number(process.env.GHN_ITEM_LENGTH_CM || 10),
    Number(process.env.GHN_ITEM_WIDTH_CM || 10),
    Number(process.env.GHN_ITEM_HEIGHT_CM || 10),
  ];
  if (dimensions.some((dimension) => !Number.isInteger(dimension) || dimension < 1 || dimension > 200)) {
    const error = new Error('Kích thước kiện GHN phải là số nguyên từ 1 đến 200 cm');
    error.status = 500;
    error.expose = true;
    throw error;
  }

  return {
    token,
    shopId,
    apiUrl,
    serviceTypeId,
    paymentTypeId,
    requiredNote,
    length: dimensions[0],
    width: dimensions[1],
    height: dimensions[2],
    itemLength: dimensions[3],
    itemWidth: dimensions[4],
    itemHeight: dimensions[5],
  };
}
