// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET ??= 'test-secret-for-guard';

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { ADMIN_COOKIE, MERCHANT_COOKIE } from '../src/auth/cookies.js';
import { issueAdminToken, issueMerchantToken, signToken } from '../src/auth/jwt.js';
import { initSchema, db } from '../src/db.js';

let server: Server;
let baseUrl: string;
let adminCookie: string;
let acmeCookie: string;
let bistroCookie: string;

before(async () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_acme', 'Acme'), ('m_bistro', 'Bistro')`).run();
  db.prepare(
    `INSERT OR IGNORE INTO orders (id, merchant_id, customer_email, total_amount, type, status)
     VALUES ('acme-1', 'm_acme', 'ana@example.com', 1000, 'sale', 'completed'),
            ('bistro-1', 'm_bistro', 'bruno@example.com', 2000, 'sale', 'completed')`,
  ).run();

  // Dev bootstrap off: these tests exercise the real authentication flow.
  server = createApp({ enableDevAdminSession: false }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  adminCookie = `${ADMIN_COOKIE}=${(await issueAdminToken('5m')).token}`;
  acmeCookie = `${MERCHANT_COOKIE}=${(await issueMerchantToken('m_acme', '5m')).token}`;
  bistroCookie = `${MERCHANT_COOKIE}=${(await issueMerchantToken('m_bistro', '5m')).token}`;
});

after(() => {
  server.close();
});

/** Issues a request with optional cookie and headers. */
function call(path: string, init: { cookie?: string; headers?: Record<string, string>; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

test('guard: no token is rejected', async () => {
  const response = await call('/api/orders');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthenticated' });
});

test('guard: a merchant token sees only its own orders', async () => {
  const response = await call('/api/orders', { cookie: acmeCookie });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { orders: Array<{ id: string }> };
  assert.deepEqual(body.orders.map((o) => o.id), ['acme-1']);
});

test('guard: a mismatching X-Merchant-Id is rejected', async () => {
  const response = await call('/api/orders', { cookie: acmeCookie, headers: { 'X-Merchant-Id': 'm_bistro' } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'merchant_mismatch' });
});

test("guard: the caller's own X-Merchant-Id is accepted and ignored", async () => {
  const response = await call('/api/orders', { cookie: acmeCookie, headers: { 'X-Merchant-Id': 'm_acme' } });
  assert.equal(response.status, 200);
});

test('guard: an admin token cannot read data', async () => {
  const response = await call('/api/orders', { cookie: adminCookie });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'token_not_scoped_for_data' });
});

test('guard: a merchant token cannot mint tokens', async () => {
  const response = await call('/api/auth/token', { method: 'POST', cookie: acmeCookie, body: { merchantId: 'm_acme' } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'token_not_scoped_for_mint' });
});

test('guard: an expired token is reported as such', async () => {
  const expired = await signToken({ role: 'merchant', scope: 'data', merchantId: 'm_acme' }, '-1s');
  const response = await call('/api/orders', { cookie: `${MERCHANT_COOKIE}=${expired}` });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'session_expired' });
});

test('auth: the admin token mints an HttpOnly merchant cookie', async () => {
  const response = await call('/api/auth/token', { method: 'POST', cookie: adminCookie, body: { merchantId: 'm_bistro' } });
  assert.equal(response.status, 204);
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${MERCHANT_COOKIE}=`));
  assert.ok(setCookie, 'expected a merchant_session cookie');
  assert.match(setCookie!, /HttpOnly/);
  assert.match(setCookie!, /SameSite=Strict/);
});

test('auth: minting for an unknown merchant is a 404', async () => {
  const response = await call('/api/auth/token', { method: 'POST', cookie: adminCookie, body: { merchantId: 'nope' } });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'merchant_not_found' });
});

test('auth: minting without a merchantId is a 400', async () => {
  const response = await call('/api/auth/token', { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(response.status, 400);
});

test("orders: another merchant's order is reported as missing (TD-02)", async () => {
  const mine = await call('/api/orders/acme-1', { cookie: acmeCookie });
  assert.equal(mine.status, 200);
  const theirs = await call('/api/orders/bistro-1', { cookie: acmeCookie });
  assert.equal(theirs.status, 404);
});

test('metrics: aggregates are scoped to the session merchant (TD-04)', async () => {
  const acme = await call('/api/metrics/summary', { cookie: acmeCookie });
  assert.deepEqual(await acme.json(), {
    merchant_id: 'm_acme',
    sales_orders: 1,
    refund_orders: 0,
    unique_customers: 1,
    avg_order_value_cents: 1000,
    avg_net_order_value_cents: 1000,
  });

  const bistro = await call('/api/metrics/summary', { cookie: bistroCookie });
  const bistroBody = (await bistro.json()) as { merchant_id: string; sales_orders: number };
  assert.equal(bistroBody.merchant_id, 'm_bistro');
  assert.equal(bistroBody.sales_orders, 1);
});

test('merchants: listing requires the admin token', async () => {
  const asMerchant = await call('/api/merchants', { cookie: acmeCookie });
  assert.equal(asMerchant.status, 403);

  const asAdmin = await call('/api/merchants', { cookie: adminCookie });
  assert.equal(asAdmin.status, 200);
  const body = (await asAdmin.json()) as { merchants: Array<{ id: string }> };
  assert.deepEqual(body.merchants.map((m) => m.id).sort(), ['m_acme', 'm_bistro']);
});

test('session: reports who the caller is', async () => {
  const anonymous = await call('/api/auth/session');
  assert.equal(anonymous.status, 401);

  const response = await call('/api/auth/session', { cookie: acmeCookie });
  const body = (await response.json()) as { role: string; merchantId: string };
  assert.equal(body.role, 'merchant');
  assert.equal(body.merchantId, 'm_acme');
});
