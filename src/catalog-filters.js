const sorts = new Set(['newest', 'price_asc', 'price_desc', 'title_asc']);

export function parseCatalogFilters(query) {
  function invalid(message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  const sort = query.sort ?? 'newest';
  if (!sorts.has(sort)) invalid('sort không hợp lệ');
  function price(key) {
    const value = query[key];
    if (value === undefined) return null;
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') {
      invalid(`${key} phải là số không âm`);
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999999.99) {
      invalid(`${key} phải là số không âm`);
    }
    return amount;
  }
  const min_price = price('min_price');
  const max_price = price('max_price');
  if (min_price !== null && max_price !== null && min_price > max_price) {
    invalid('Khoảng giá không hợp lệ');
  }
  if (query.in_stock !== undefined && !['0', '1'].includes(query.in_stock)) {
    invalid('in_stock chỉ nhận 0 hoặc 1');
  }
  return { sort, min_price, max_price, in_stock: query.in_stock === '1' };
}
