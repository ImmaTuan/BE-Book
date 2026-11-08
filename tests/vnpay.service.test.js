import { getVnpayConfig } from '../src/config/vnpay.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { canonicalVnpayParams, signVnpayParams, verifyVnpayCallback, buildPaymentUrl, vnpayDate, queryVnpayTransaction, QUERY_RESPONSE_FIELDS } from '../src/services/vnpay.service.js';

const config = { tmnCode: 'TESTCODE', hashSecret: 'test-secret-only', paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', returnUrl: 'http://localhost:3000/api/payments/vnpay/return', queryUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction' };
const base = { vnp_TmnCode: 'TESTCODE', vnp_TxnRef: 'VP24abc123', vnp_Amount: '9550000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '123456' };
const signed = (params) => ({ ...params, vnp_SecureHash: signVnpayParams(params, config.hashSecret) });

test('VNPAY canonicalization matches sorted form encoding and HMAC SHA512', () => {
  const params = { vnp_TxnRef: 'VP24', vnp_OrderInfo: 'Thanh toan + don hang', vnp_Amount: '9550000' };
  const encoded = 'vnp_Amount=9550000&vnp_OrderInfo=Thanh+toan+%2B+don+hang&vnp_TxnRef=VP24';
  assert.equal(canonicalVnpayParams(params), encoded);
  assert.equal(signVnpayParams(params, config.hashSecret), createHmac('sha512', config.hashSecret).update(encoded).digest('hex'));
});

test('links use server amount x100, Vietnam timezone, return URL and a 15 minute expiry', () => {
  const createdAt = new Date('2026-11-08T04:00:00Z');
  const url = new URL(buildPaymentUrl({ reference: 'VP24abc123', amount: 95500, ip: '127.0.0.1', createdAt }, config));
  assert.equal(url.searchParams.get('vnp_Amount'), '9550000');
  assert.equal(url.searchParams.get('vnp_CreateDate'), '20261108110000');
  assert.equal(url.searchParams.get('vnp_ExpireDate'), '20261108111500');
  assert.equal(url.searchParams.get('vnp_ReturnUrl'), config.returnUrl);
  assert.equal(url.searchParams.get('vnp_SecureHash'), signVnpayParams(Object.fromEntries(url.searchParams), config.hashSecret));
  for (const amount of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => buildPaymentUrl({ reference: 'VP24', amount, ip: '127.0.0.1' }, config));
  assert.equal(vnpayDate(createdAt), '20261108110000');
});

test('callbacks require correct signature, terminal, amount format, unique scalar parameters and transaction number', () => {
  assert.ok(verifyVnpayCallback(signed(base), config));
  assert.equal(verifyVnpayCallback({ ...signed(base), vnp_Amount: '100' }, config), null);
  assert.equal(verifyVnpayCallback(signed({ ...base, vnp_TmnCode: 'OTHER' }), config), null);
  assert.equal(verifyVnpayCallback({ ...signed(base), vnp_TxnRef: ['VP24', 'VP25'] }, config), null);
  assert.equal(verifyVnpayCallback(signed({ ...base, vnp_TransactionNo: '0' }), config), null);
  assert.equal(verifyVnpayCallback(signed({ ...base, vnp_Amount: '9.55e6' }), config), null);
  assert.equal(verifyVnpayCallback({ ...signed(base), vnp_SecureHash: 'x' }, config), null);
});

test('QueryDR validates its distinct request/response checksum and treats unconfirmed results as pending', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const attempt = { reference: base.vnp_TxnRef, create_date: '20261108110000' };
  const response = { ...base, vnp_ResponseId: 'response123', vnp_Command: 'querydr', vnp_Message: 'Success', vnp_BankCode: 'NCB', vnp_PayDate: '20261108110500', vnp_TransactionType: '01', vnp_OrderInfo: 'Test', vnp_PromotionCode: '', vnp_PromotionAmount: '' };
  response.vnp_SecureHash = createHmac('sha512', config.hashSecret).update(QUERY_RESPONSE_FIELDS.map(key => response[key] ?? '').join('|')).digest('hex');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, config.queryUrl);
    const params = JSON.parse(options.body);
    const fields = ['vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo'];
    assert.equal(params.vnp_SecureHash, createHmac('sha512', config.hashSecret).update(fields.map(key => params[key]).join('|')).digest('hex'));
    return { ok: true, json: async () => response };
  };
  assert.equal((await queryVnpayTransaction(attempt, '127.0.0.1', config)).params.vnp_TransactionStatus, '00');
  response.vnp_Amount = '100';
  await assert.rejects(queryVnpayTransaction(attempt, '127.0.0.1', config), error => error.status === 502);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ vnp_ResponseCode: '91' }) });
  assert.deepEqual(await queryVnpayTransaction(attempt, '127.0.0.1', config), { pending: true, code: '91' });
});

test('local Return confirmation cannot be enabled for production or public endpoints', async (t) => {
  const old = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
  });
  Object.assign(process.env, { VNP_TMN_CODE: 'TESTCODE', VNP_HASH_SECRET: 'test-secret', VNP_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', VNP_RETURN_URL: 'http://localhost:3000/api/payments/vnpay/return', VNP_FRONTEND_URL: 'http://localhost:5173', VNP_LOCAL_RETURN_CONFIRM: 'true' });
  assert.equal(getVnpayConfig().confirmSandboxReturn, true);
  process.env.VNP_URL = 'https://pay.vnpay.vn/vpcpay.html';
  assert.throws(() => getVnpayConfig(), error => error.status === 503);
  process.env.VNP_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  process.env.VNP_RETURN_URL = 'https://shop.example/api/payments/vnpay/return';
  assert.throws(() => getVnpayConfig(), error => error.status === 503);
  process.env.VNP_LOCAL_RETURN_CONFIRM = 'false';
  assert.equal(getVnpayConfig().confirmSandboxReturn, false);
});
