import * as ghn from '../services/ghn.service.js';
import { fail, id } from '../validation.js';

export async function listGhnProvinces(req, res) {
  if (!ghn.isGhnConfigured()) fail('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);
  res.json({ data: await ghn.getGhnProvinces() });
}

export async function listGhnWards(req, res) {
  if (!ghn.isGhnConfigured()) fail('Cần cấu hình GHN_TOKEN và GHN_SHOP_ID trước', 503);
  const wards = await ghn.getGhnWards(id(req.params.provinceId));
  if (!Array.isArray(wards)) fail('GHN không tìm thấy tỉnh/thành đã chọn', 404);
  res.json({ data: wards });
}
