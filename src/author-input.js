function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function validateAuthorIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)
  ) {
    invalid("author_ids phải là danh sách tối đa 50 ID nguyên dương");
  }
  return [...new Set(value)];
}

export function validateAuthor(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    invalid("Body phải là JSON object");
  if (Object.keys(body).some((key) => !["name", "biography"].includes(key)))
    invalid("Chỉ nhận name và biography");
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 255
  )
    invalid("Tên tác giả phải từ 1 đến 255 ký tự");
  const result = { name: body.name.normalize("NFC").trim() };
  if (body.biography !== undefined) {
    if (body.biography !== null && typeof body.biography !== "string")
      invalid("Tiểu sử phải là chuỗi hoặc null");
    if (
      typeof body.biography === "string" &&
      Buffer.byteLength(body.biography) > 65535
    )
      invalid("Tiểu sử tác giả quá dài");
    result.biography = body.biography?.trim() || null;
  }
  return result;
}
