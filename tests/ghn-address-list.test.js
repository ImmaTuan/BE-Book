import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGhnAddressList, filterGhnProvinceList } from '../src/ghn-address-list.js';

test('excludes GHN test places at every address level', () => {
  for (const key of ['ProvinceName', 'DistrictName', 'WardName']) {
    const real = { id: 1, [key]: 'Địa danh thật' };
    assert.deepEqual(filterGhnAddressList([
      real, { id: 2, [key]: 'Test - Alert - 001' }, { id: 3, [key]: 'Phường TEST' },
    ], [key]), [real]);
  }
});

test('preserves carrier IDs and same-name geographic records', () => {
  const records = [{ ProvinceID: 1, ProvinceName: 'Bình Thuận' }, { ProvinceID: 2, ProvinceName: 'Bình Thuận' }];
  assert.deepEqual(filterGhnAddressList(records, ['ProvinceName']), records);
});

test('supports name aliases, excludes empty entries and preserves invalid upstream responses', () => {
  const real = { name: 'Hà Nội' };
  assert.deepEqual(filterGhnAddressList([null, {}, { ProvinceName: '' }, { name: 'Test province' }, real], ['ProvinceName', 'name']), [real]);
  assert.equal(filterGhnAddressList(null, ['name']), null);
});

test('removes numbered staging province copies while preserving the canonical carrier ID', () => {
  const hanoi = { ProvinceID: 201, ProvinceName: 'Hà Nội', Code: '4' };
  const other = { ProvinceID: 202, ProvinceName: 'Hồ Chí Minh', Code: '8' };
  assert.deepEqual(filterGhnProvinceList([
    { ProvinceID: 2002, ProvinceName: 'Hà Nội 02', Code: '4' },
    { ProvinceID: 298, ProvinceName: 'Test - Alert - Tỉnh - 001' },
    other, hanoi,
  ]), [other, hanoi]);
});

test('does not guess province replacements from a number or name alone', () => {
  const records = [
    { ProvinceID: 1, ProvinceName: 'Place 02', Code: '1' },
    { ProvinceID: 2, ProvinceName: 'Place', Code: '2' },
    { ProvinceID: 3, ProvinceName: 'Place 03' },
  ];
  assert.deepEqual(filterGhnProvinceList(records), records);
  assert.equal(filterGhnProvinceList(null), null);
});
