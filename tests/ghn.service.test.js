import test from 'node:test';
import assert from 'node:assert/strict';
import { createGhnShipment, previewGhnShipment } from '../src/services/ghn.service.js';

const order = {
  order_code: 'TEST-24',
  package_weight_grams: 300,
  recipient_name: 'Recipient',
  recipient_phone: '0900000000',
  shipping_address: '123 Test street',
  ghn_to_ward_name: 'Recipient ward',
  ghn_to_province_name: 'Recipient province',
  ghn_is_new_to_address: true,
  cod_amount: 100000,
  subtotal: 100000,
  items: [{ book_id: 1, book_title: 'Book', quantity: 1, unit_price: 100000, weight_grams: 300 }],
};

test('GHN resolves sender address independently of recipient address', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    GHN_TOKEN: 'test-token',
    GHN_SHOP_ID: '235503',
    GHN_API_URL: 'https://dev-online-gateway.ghn.vn',
    GHN_SERVICE_TYPE_ID: '2',
    GHN_PAYMENT_TYPE_ID: '1',
    GHN_REQUIRED_NOTE: 'CHOXEMHANGKHONGTHU',
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  function mockGhn({ shop = { _id: 235503, ward_code: '20413 ', district_id: 1446, is_new_address: false }, failCreate = false } = {}) {
    const shipments = [];
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      assert.equal(options.headers.Token, 'test-token');
      assert.equal(options.headers.ShopId, '235503');
      let data;
      if (path.endsWith('/shop/all')) {
        data = { shops: shop ? [shop] : [] };
      } else if (path.endsWith('/master-data/district')) {
        data = [{ DistrictID: 1446, DistrictName: 'Quan 4', ProvinceID: 202 }];
      } else if (path.endsWith('/master-data/ward')) {
        assert.equal(new URL(url).searchParams.get('district_id'), '1446');
        data = [{ WardCode: '20413', WardName: 'Phuong 15' }];
      } else if (path.endsWith('/master-data/province')) {
        data = [{ ProvinceID: 202, ProvinceName: 'Ho Chi Minh' }];
      } else if (path.endsWith('/shipping-order/create') || path.endsWith('/shipping-order/preview')) {
        shipments.push(JSON.parse(options.body));
        if (failCreate) return { ok: false, json: async () => ({ code: 400, message: 'GHN rejected request' }) };
        data = { order_code: 'GHN-TEST-24', total_fee: 22000 };
      } else {
        assert.fail('Unexpected GHN endpoint: ' + path);
      }
      return { ok: true, json: async () => ({ code: 200, data }) };
    };
    return shipments;
  }

  await t.test('trims shop ward code and sends canonical sender names with old address flag', async () => {
    const shipments = mockGhn();
    const shipment = await createGhnShipment(order);
    assert.equal(shipment.orderCode, 'GHN-TEST-24');
    assert.equal(shipment.fee, 22000);
    assert.equal(shipments.length, 1);
    const payload = shipments[0];
    assert.equal(payload.from_ward_name, 'Phuong 15');
    assert.equal(payload.from_district_name, 'Quan 4');
    assert.equal(payload.from_province_name, 'Ho Chi Minh');
    assert.equal(payload.is_new_from_address, false);
    assert.equal(payload.is_new_to_address, true);
    assert.equal(payload.to_ward_name, order.ghn_to_ward_name);
    assert.equal(payload.client_order_code, order.order_code);
    assert.equal(payload.cod_amount, order.cod_amount);
  });

  await t.test('new sender address does not inherit the recipient address scheme', async () => {
    const shipments = mockGhn({ shop: { _id: 235503, is_new_address: true } });
    await createGhnShipment({ ...order, ghn_is_new_to_address: false, ghn_to_district_name: 'Recipient district' });
    assert.equal(shipments[0].is_new_from_address, true);
    assert.equal(shipments[0].is_new_to_address, false);
    assert.equal(shipments[0].to_district_name, 'Recipient district');
    assert.equal('from_ward_name' in shipments[0], false);
  });

  await t.test('unknown shop fails before submitting a shipment', async () => {
    const shipments = mockGhn({ shop: null });
    await assert.rejects(createGhnShipment(order), error => error.status === 503 && error.message.includes('GHN_SHOP_ID'));
    assert.equal(shipments.length, 0);
  });

  await t.test('missing sender metadata fails before submitting a shipment', async () => {
    const shipments = mockGhn({ shop: { _id: 235503, district_id: 1446 } });
    await assert.rejects(createGhnShipment(order), error => error.status === 503 && error.expose === true);
    assert.equal(shipments.length, 0);
  });

  await t.test('unknown ward fails before submitting a shipment', async () => {
    const shipments = mockGhn({ shop: { _id: 235503, district_id: 1446, ward_code: 'missing' } });
    await assert.rejects(createGhnShipment(order), error => error.status === 503 && error.expose === true);
    assert.equal(shipments.length, 0);
  });

  await t.test('COD collects discounted books only; GHN collects buyer shipping separately', async () => {
    process.env.GHN_PAYMENT_TYPE_ID = '2';
    const shipments = mockGhn();
    await createGhnShipment({ ...order, payment_method: 'cod', subtotal: 113000, discount_amount: 100000, shipping_fee: 82500, cod_amount: 95500 });
    assert.equal(shipments[0].cod_amount, 13000);
    assert.equal(shipments[0].payment_type_id, 2);
  });

  await t.test('unpaid VNPAY cannot create a shipment', async () => {
    const shipments = mockGhn();
    await assert.rejects(createGhnShipment({ ...order, payment_method: 'vnpay' }), error => error.status === 409);
    assert.equal(shipments.length, 0);
  });

  await t.test('paid VNPAY ships with zero COD and shop-paid freight', async () => {
    const shipments = mockGhn();
    const shipment = await createGhnShipment({ ...order, payment_method: 'vnpay', payment_status: 'paid' });
    assert.equal(shipments[0].cod_amount, 0);
    assert.equal(shipments[0].payment_type_id, 1);
    assert.equal(shipment.paymentTypeId, 1);
  });

  await t.test('VNPAY can preview shipping before paying', async () => {
    const shipments = mockGhn();
    const preview = await previewGhnShipment({ ...order, payment_method: 'vnpay', payment_status: 'unpaid' });
    assert.equal(preview.fee, 22000);
    assert.equal(shipments[0].cod_amount, 0);
  });

  await t.test('shipment failures still propagate', async () => {
    mockGhn({ failCreate: true });
    await assert.rejects(createGhnShipment(order), error => error.status === 502 && error.message === 'GHN rejected request');
  });
});
