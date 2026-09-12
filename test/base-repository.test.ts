// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissingAuthContextError, runWithAuthContext } from '../src/auth/context.js';
import { ScopeError } from '../src/dal/base-repository.js';
import { merchantsRepository } from '../src/dal/merchants-repository.js';
import { metricsRepository } from '../src/dal/metrics-repository.js';
import { ordersRepository } from '../src/dal/orders-repository.js';
import { initSchema, db } from '../src/db.js';

/** Seeds two merchants with one order each. */
function seed(): void {
  initSchema();
  // Tests share one in-memory database, so start from a known set of rows.
  db.exec('DELETE FROM orders');
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_acme', 'Acme'), ('m_bistro', 'Bistro')`).run();
  db.prepare(
    `INSERT OR IGNORE INTO orders (id, merchant_id, customer_email, total_amount, type, status)
     VALUES ('acme-1', 'm_acme', 'ana@example.com', 1000, 'sale', 'completed'),
            ('bistro-1', 'm_bistro', 'bruno@example.com', 2000, 'sale', 'completed')`,
  ).run();
}

/** Runs a function as a merchant caller. */
function asMerchant<T>(merchantId: string, fn: () => T): T {
  return runWithAuthContext({ role: 'merchant', scope: 'data', merchantId }, fn);
}

/** Runs a function as an admin caller. */
function asAdmin<T>(fn: () => T): T {
  return runWithAuthContext({ role: 'admin', scope: 'mint' }, fn);
}

test('base repository: refuses to query without an auth context', () => {
  seed();
  assert.throws(() => ordersRepository.list(), MissingAuthContextError);
});

test('base repository: refuses to query for a caller without merchant scope', () => {
  seed();
  assert.throws(() => asAdmin(() => ordersRepository.list()), ScopeError);
});

test('base repository: list only returns the caller merchant rows', () => {
  seed();
  const acme = asMerchant('m_acme', () => ordersRepository.list());
  assert.deepEqual(acme.map((o) => o.id), ['acme-1']);
  const bistro = asMerchant('m_bistro', () => ordersRepository.list());
  assert.deepEqual(bistro.map((o) => o.id), ['bistro-1']);
});

test("base repository: getById hides another merchant's order (TD-02)", () => {
  seed();
  assert.equal(asMerchant('m_acme', () => ordersRepository.getById('acme-1'))?.id, 'acme-1');
  assert.equal(asMerchant('m_acme', () => ordersRepository.getById('bistro-1')), undefined);
});

test('base repository: insert forces the merchant column to the caller scope', () => {
  seed();
  const created = asMerchant('m_bistro', () =>
    ordersRepository.create({
      id: 'scoped-1',
      customer_email: 'x@y.com',
      total_amount: 700,
      type: 'sale',
      status: 'completed',
    }),
  );
  assert.equal(created.merchant_id, 'm_bistro');
  assert.equal(asMerchant('m_acme', () => ordersRepository.getById('scoped-1')), undefined);
});

test('metrics repository: aggregates are scoped too (TD-04)', () => {
  seed();
  const acme = asMerchant('m_acme', () => metricsRepository.summary());
  assert.equal(acme.sales_orders, 1);
  assert.equal(acme.avg_order_value_cents, 1000);

  const customers = asMerchant('m_bistro', () => metricsRepository.topCustomers(5));
  assert.deepEqual(customers.map((c) => c.customer_email), ['bruno@example.com']);
});

test('merchants repository: admin only', () => {
  seed();
  assert.equal(asAdmin(() => merchantsRepository.list()).length, 2);
  assert.equal(asAdmin(() => merchantsRepository.exists('m_acme')), true);
  assert.equal(asAdmin(() => merchantsRepository.exists('nope')), false);
  assert.throws(() => asMerchant('m_acme', () => merchantsRepository.list()), ScopeError);
});
