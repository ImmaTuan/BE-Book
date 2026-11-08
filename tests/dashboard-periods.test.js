import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardRange, bucketStart, dashboardSeries } from '../src/dashboard-periods.js';

test('dashboard period defaults use the Vietnam date and fill the requested number of periods', () => {
  const now = new Date('2026-11-07T18:00:00Z'); // Nov 8 in Vietnam.
  const counts = { day: 30, week: 12, month: 12, quarter: 8, year: 5 };
  for (const [period, count] of Object.entries(counts)) {
    const range = dashboardRange({ period }, now);
    assert.equal(range.to, '2026-11-08');
    assert.equal(range.buckets.length, count);
  }
  assert.equal(dashboardRange({ period: 'month' }, new Date('2026-03-31T06:00:00Z')).from, '2025-04-01');
});

test('weeks start on Monday and quarter/year buckets handle boundaries', () => {
  assert.equal(bucketStart('2026-11-08', 'week'), '2026-11-02');
  assert.equal(bucketStart('2026-01-01', 'week'), '2025-12-29');
  assert.equal(bucketStart('2026-03-31', 'quarter'), '2026-01-01');
  assert.equal(bucketStart('2026-04-01', 'quarter'), '2026-04-01');
  assert.equal(bucketStart('2026-12-31', 'quarter'), '2026-10-01');
  assert.equal(bucketStart('2026-12-31', 'year'), '2026-01-01');
});

test('invalid dates, inverted ranges and excessive chart density are rejected', () => {
  for (const query of [
    { period: 'invalid' }, { period: ['day'] }, { from: '2026-02-30', to: '2026-03-05' },
    { from: '2026-01-02', to: '2026-01-01' }, { from: '2026-01-01' },
    { period: 'day', from: '2020-01-01', to: '2026-01-01' },
    { period: 'year', from: '2000-01-01', to: '2026-01-01' },
  ]) assert.throws(() => dashboardRange(query), error => error.status === 400);
});

test('series preserves amounts and negative net revenue, fills empty buckets and excludes outside days', () => {
  const range = dashboardRange({ period: 'month', from: '2026-01-01', to: '2026-03-31' });
  const rows = dashboardSeries([
    { day: '2026-01-01', orders: '1', units: 2, gross_revenue: '95500', shipping_fee: '82500', net_revenue: '13000' },
    { day: '2026-01-10', orders: 1, units: 1, gross_revenue: 10000, shipping_fee: 20000, net_revenue: -10000, legacy_paid_orders: 1 },
    { day: '2026-03-01', orders: 1, units: 1, gross_revenue: 50000, shipping_fee: 0, net_revenue: 50000 },
    { day: '2025-12-31', orders: 99, gross_revenue: 999999 },
  ], range);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].gross_revenue, 105500);
  assert.equal(rows[0].net_revenue, 3000);
  assert.equal(rows[0].units, 3);
  assert.equal(rows[0].legacy_paid_orders, 1);
  assert.equal(rows[1].gross_revenue, 0);
  assert.equal(rows[1].orders, 0);
  assert.equal(rows[2].net_revenue, 50000);
});
