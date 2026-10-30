function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function validatePublisherNames(value) {
  if (!Array.isArray(value) || value.length > 50)
    invalid("Nhà xuất bản phải là danh sách tối đa 50 tên");
  const names = new Map();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 255)
      invalid("Tên nhà xuất bản phải từ 1 đến 255 ký tự");
    const name = item.normalize("NFC").trim();
    names.set(name.toLocaleLowerCase("vi-VN"), name);
  }
  return [...names.values()];
}

export function validatePublisherIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)
  ) {
    invalid("publisher_ids phải là danh sách tối đa 50 ID nguyên dương");
  }
  return [...new Set(value)];
}

export function validatePublisher(body, create = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    invalid("Body phải là JSON object");
  if (
    Object.keys(body).some(
      (key) => !["name", "description", "website"].includes(key),
    )
  )
    invalid("Chỉ nhận name, description và website");
  if (!Object.keys(body).length) invalid("Không có dữ liệu để cập nhật");
  if (create && body.name === undefined) invalid("Thiếu tên nhà xuất bản");
  const result = {};
  if (body.name !== undefined)
    result.name = validatePublisherNames([body.name])[0];
  for (const key of ["description", "website"]) {
    if (body[key] === undefined) continue;
    if (body[key] === null) {
      result[key] = null;
      continue;
    }
    if (typeof body[key] !== "string")
      invalid(`${key} phải là chuỗi hoặc null`);
    const value = body[key].trim();
    if (key === "description" && Buffer.byteLength(value) > 65535)
      invalid("Mô tả nhà xuất bản quá dài");
    if (key === "website" && value) {
      if (value.length > 2048) invalid("Website tối đa 2048 ký tự");
      try {
        if (!["http:", "https:"].includes(new URL(value).protocol))
          invalid("Website phải là URL http/https");
      } catch {
        invalid("Website phải là URL http/https");
      }
    }
    result[key] = value || null;
  }
  return result;
}
