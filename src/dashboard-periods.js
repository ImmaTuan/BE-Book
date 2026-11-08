import { fail } from './validation.js';
export const DASHBOARD_PERIODS = ['day', 'week', 'month', 'quarter', 'year'];
const iso = date => date.toISOString().slice(0, 10);
const dayDate = value => new Date(value + 'T00:00:00Z');
const addDays = (date, count) => new Date(date.getTime() + count * 86400000);

export function bucketStart(value, period) {
  const date = dayDate(value);
  if (period === 'week') return iso(addDays(date, -((date.getUTCDay() + 6) % 7)));
  if (period === 'month') date.setUTCDate(1);
  if (period === 'quarter') { date.setUTCDate(1); date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3); }
  if (period === 'year') { date.setUTCDate(1); date.setUTCMonth(0); }
  return iso(date);
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(dayDate(value).getTime()) && iso(dayDate(value)) === value
    && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
}

export function dashboardRange(query = {}, now = new Date()) {
  const period = query.period ?? 'month';
  if (!DASHBOARD_PERIODS.includes(period)) fail('period chỉ nhận day, week, month, quarter hoặc year');
  const today = new Date(now.getTime() + 7 * 3600000);
  let from;
  let to = iso(today);
  if (query.from !== undefined || query.to !== undefined) {
    if (!validDay(query.from) || !validDay(query.to)) fail('from và to phải là ngày hợp lệ dạng YYYY-MM-DD');
    from = query.from; to = query.to;
  } else {
    const start = dayDate(to);
    if (period === 'day') from = iso(addDays(start, -29));
    else if (period === 'week') from = iso(addDays(dayDate(bucketStart(to, 'week')), -11 * 7));
    else if (period === 'month') { start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 11); from = iso(start); }
    else if (period === 'quarter') { start.setUTCDate(1); start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3 - 21); from = iso(start); }
    else { start.setUTCDate(1); start.setUTCMonth(0); start.setUTCFullYear(start.getUTCFullYear() - 4); from = iso(start); }
  }
  if (from > to) fail('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  if ((dayDate(to) - dayDate(from)) / 86400000 > 3660) fail('Khoảng thống kê tối đa 10 năm');
  const keys = new Set();
  for (let day = dayDate(from); iso(day) <= to; day = addDays(day, 1)) keys.add(bucketStart(iso(day), period));
  if (keys.size > 400) fail('Khoảng chọn có quá nhiều điểm dữ liệu; hãy chọn tuần, tháng, quý hoặc năm');
  return { period, from, to, toExclusive: iso(addDays(dayDate(to), 1)), buckets: [...keys] };
}

const numericKeys = ['orders', 'units', 'gross_revenue', 'shipping_fee', 'net_revenue', 'legacy_paid_orders'];
export function dashboardSeries(dailyRows, range) {
  const series = range.buckets.map(start => Object.fromEntries([['start', start], ...numericKeys.map(key => [key, 0])]));
  const byStart = new Map(series.map(row => [row.start, row]));
  for (const daily of dailyRows) {
    if (daily.day < range.from || daily.day > range.to) continue;
    const row = byStart.get(bucketStart(daily.day, range.period));
    if (!row) continue;
    for (const key of numericKeys) row[key] += Number(daily[key] || 0);
  }
  for (const row of series) for (const key of numericKeys) row[key] = Math.round(row[key] * 100) / 100;
  return series;
}
