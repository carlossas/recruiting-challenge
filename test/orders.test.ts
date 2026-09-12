// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithAuthContext } from '../src/auth/context.js';
import { initSchema, db } from '../src/db.js';
import { ordersRepository } from '../src/dal/orders-repository.js';

/** Runs a function as a merchant caller. */
function asMerchant<T>(merchantId: string, fn: () => T): T {
  return runWithAuthContext({ role: 'merchant', scope: 'data', merchantId }, fn);
}

test('orders repository: create + list returns the order', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();

  const created = asMerchant('m_test', () =>
    ordersRepository.create({
      id: 'o1',
      customer_email: 'a@b.com',
      total_amount: 5000,
      type: 'sale',
      status: 'completed',
    }),
  );

  assert.equal(created.id, 'o1');
  assert.equal(created.merchant_id, 'm_test');
  const list = asMerchant('m_test', () => ordersRepository.list());
  assert.equal(list.length, 1);
  assert.equal(list[0]!.total_amount, 5000);
});

test('orders repository: getById returns the order', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();

  asMerchant('m_test', () =>
    ordersRepository.create({
      id: 'o2',
      customer_email: 'c@d.com',
      total_amount: 1200,
      type: 'sale',
      status: 'completed',
    }),
  );

  const got = asMerchant('m_test', () => ordersRepository.getById('o2'));
  assert.equal(got?.total_amount, 1200);
});
