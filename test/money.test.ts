// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runWithAuthContext } from '../src/auth/context.js';
import { metricsRepository } from '../src/dal/metrics-repository.js';
import { ordersRepository } from '../src/dal/orders-repository.js';
import { initSchema, db } from '../src/db.js';

const MERCHANT = 'm_money';
const FROM = '2026-01-01';
const TO = '2027-01-01';

/** Runs a function as the test merchant. */
function asMerchant<T>(fn: () => T): T {
  return runWithAuthContext({ role: 'merchant', scope: 'data', merchantId: MERCHANT }, fn);
}

/** Resets the orders table and registers the test merchant. */
function reset(): void {
  initSchema();
  db.exec('DELETE FROM orders');
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES (?, 'Money')`).run(MERCHANT);
}

/** Inserts an order with an explicit timestamp, bypassing the repository. */
function addOrder(type: 'sale' | 'refund', amount: number, email = 'ana@example.com', createdAt = '2026-06-01T10:00:00.000Z'): void {
  db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
  ).run(randomUUID(), MERCHANT, email, amount, type, createdAt);
}

test('revenue: refunds subtract instead of adding (TD-05)', () => {
  reset();
  addOrder('sale', 1000);
  addOrder('sale', 2000);
  addOrder('refund', 500);

  const revenue = asMerchant(() => ordersRepository.revenue(FROM, TO));
  assert.deepEqual(revenue, { netCents: 2500, grossSalesCents: 3000, refundsCents: 500 });
  // The old behaviour (SUM of every amount) would have reported 3500.
  assert.notEqual(revenue.netCents, 3500);
});

test('revenue: a sale and its refund cancel out', () => {
  reset();
  addOrder('sale', 4200);
  const before = asMerchant(() => ordersRepository.revenue(FROM, TO)).netCents;

  addOrder('sale', 7000);
  addOrder('refund', 7000);
  const after = asMerchant(() => ordersRepository.revenue(FROM, TO)).netCents;

  assert.equal(after, before);
});

test('revenue: a fully refunded period nets to zero', () => {
  reset();
  addOrder('sale', 1500);
  addOrder('refund', 1500);

  assert.equal(asMerchant(() => ordersRepository.revenue(FROM, TO)).netCents, 0);
});

test('revenue: a refunds-only period is negative and is not clamped', () => {
  reset();
  addOrder('refund', 900);
  addOrder('refund', 100);

  const revenue = asMerchant(() => ordersRepository.revenue(FROM, TO));
  assert.equal(revenue.netCents, -1000);
  assert.equal(revenue.grossSalesCents, 0);
  assert.equal(revenue.refundsCents, 1000);
});

test('revenue: gross minus refunds always reconciles with net', () => {
  reset();
  for (const [type, amount] of [
    ['sale', 1234],
    ['sale', 5678],
    ['refund', 999],
    ['sale', 4321],
    ['refund', 4321],
  ] as Array<['sale' | 'refund', number]>) {
    addOrder(type, amount);
  }

  const { netCents, grossSalesCents, refundsCents } = asMerchant(() => ordersRepository.revenue(FROM, TO));
  assert.equal(grossSalesCents - refundsCents, netCents);
});

test('revenue: only orders inside the range are counted', () => {
  reset();
  addOrder('sale', 1000, 'ana@example.com', '2026-06-01T10:00:00.000Z');
  addOrder('sale', 2000, 'ana@example.com', '2025-06-01T10:00:00.000Z');

  assert.equal(asMerchant(() => ordersRepository.revenue(FROM, TO)).netCents, 1000);
});

test('summary: sales and refunds are counted separately (TD-06)', () => {
  reset();
  addOrder('sale', 1000, 'ana@example.com');
  addOrder('sale', 3000, 'bruno@example.com');
  addOrder('refund', 1000, 'ana@example.com');

  const summary = asMerchant(() => metricsRepository.summary());
  assert.equal(summary.sales_orders, 2);
  assert.equal(summary.refund_orders, 1);
  assert.equal(summary.unique_customers, 2);
  // Average of the sales themselves: (1000 + 3000) / 2.
  assert.equal(summary.avg_order_value_cents, 2000);
  // Net per sale: (4000 - 1000) / 2.
  assert.equal(summary.avg_net_order_value_cents, 1500);
});

test('summary: a customer who only refunded is not counted as a customer', () => {
  reset();
  addOrder('sale', 1000, 'ana@example.com');
  addOrder('refund', 500, 'ghost@example.com');

  assert.equal(asMerchant(() => metricsRepository.summary()).unique_customers, 1);
});

test('summary: an empty merchant reports zeros, not NaN', () => {
  reset();

  assert.deepEqual(asMerchant(() => metricsRepository.summary()), {
    sales_orders: 0,
    refund_orders: 0,
    unique_customers: 0,
    avg_order_value_cents: 0,
    avg_net_order_value_cents: 0,
  });
});

test('top customers: ranked by net spend, refunds push a customer down', () => {
  reset();
  addOrder('sale', 10000, 'returns@example.com');
  addOrder('refund', 12000, 'returns@example.com');
  addOrder('sale', 3000, 'loyal@example.com');

  const customers = asMerchant(() => metricsRepository.topCustomers(5));
  assert.deepEqual(customers.map((c) => c.customer_email), ['loyal@example.com', 'returns@example.com']);
  assert.equal(customers[0]!.total_spent, 3000);
  assert.equal(customers[1]!.total_spent, -2000);
  // Refunds are not orders.
  assert.equal(customers[1]!.order_count, 1);
});
