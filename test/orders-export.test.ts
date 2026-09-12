// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET ??= 'test-secret-for-export';

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { ADMIN_COOKIE, MERCHANT_COOKIE } from '../src/auth/cookies.js';
import { issueAdminToken, issueMerchantToken } from '../src/auth/jwt.js';
import { initSchema, db } from '../src/db.js';

const RANGE = 'from=2000-01-01&to=2030-01-01';

let server: Server;
let baseUrl: string;
let acmeCookie: string;
let adminCookie: string;

before(async () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_acme', 'Acme'), ('m_bistro', 'Bistro')`).run();
  db.exec('DELETE FROM orders');
  const insert = db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
  );
  insert.run('exp-1', 'm_acme', 'ana@example.com', 10000, 'sale', '2026-06-01T10:00:00.000Z');
  insert.run('exp-2', 'm_acme', 'Doe, "Jane"\nsecond@example.com', 2500, 'sale', '2026-06-02T10:00:00.000Z');
  insert.run('exp-3', 'm_acme', '=HYPERLINK("http://evil","click")', 4000, 'refund', '2026-06-03T10:00:00.000Z');
  insert.run('exp-4', 'm_bistro', 'bruno@example.com', 7777, 'sale', '2026-06-04T10:00:00.000Z');

  server = createApp({ enableDevAdminSession: false }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  acmeCookie = `${MERCHANT_COOKIE}=${(await issueMerchantToken('m_acme', '5m')).token}`;
  adminCookie = `${ADMIN_COOKIE}=${(await issueAdminToken('5m')).token}`;
});

after(() => {
  server.close();
});

/** Requests a path with an optional cookie. */
function call(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

/**
 * Reads a response body as CSV text. `Response.text()` strips a leading BOM while decoding,
 * so the marker is asserted separately on the raw bytes.
 */
async function csvText(response: Response): Promise<string> {
  return (await response.text()).replace(/^﻿/, '');
}

/** Minimal RFC 4180 parser, enough to read back what the export writes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += char;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test('export: the route is not swallowed by GET /:id', async () => {
  const response = await call(`/api/orders/export.csv?${RANGE}`, acmeCookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /^text\/csv/);
});

test('export: requires a merchant session', async () => {
  assert.equal((await call(`/api/orders/export.csv?${RANGE}`)).status, 401);

  const asAdmin = await call(`/api/orders/export.csv?${RANGE}`, adminCookie);
  assert.equal(asAdmin.status, 403);
  assert.deepEqual(await asAdmin.json(), { error: 'token_not_scoped_for_data' });
});

test('export: contains only the caller merchant rows', async () => {
  const text = await csvText(await call(`/api/orders/export.csv?${RANGE}`, acmeCookie));
  assert.ok(!text.includes('bruno@example.com'), "another merchant's row leaked into the export");
  assert.ok(text.includes('ana@example.com'));
});

test('export: the file really starts with a UTF-8 BOM', async () => {
  // Checked on the bytes: Excel needs the marker, and fetch's text() would hide its absence.
  const bytes = new Uint8Array(await (await call(`/api/orders/export.csv?${RANGE}`, acmeCookie)).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('export: has the documented header', async () => {
  const rows = parseCsv(await csvText(await call(`/api/orders/export.csv?${RANGE}`, acmeCookie)));
  assert.deepEqual(rows[0], [
    'order_id',
    'created_at',
    'customer_email',
    'type',
    'status',
    'amount_cents',
    'signed_amount_cents',
    'amount',
  ]);
});

test('export: rows are chronological and refunds carry a negative signed amount', async () => {
  const rows = parseCsv(await csvText(await call(`/api/orders/export.csv?${RANGE}`, acmeCookie))).slice(1);

  assert.deepEqual(rows.map((r) => r[0]), ['exp-1', 'exp-2', 'exp-3']);
  const refund = rows.find((r) => r[3] === 'refund')!;
  assert.equal(refund[5], '4000');
  assert.equal(refund[6], '-4000');
  assert.equal(refund[7], '40.00');
});

test('export: sums to the same net revenue the API reports', async () => {
  const rows = parseCsv(await csvText(await call(`/api/orders/export.csv?${RANGE}`, acmeCookie))).slice(1);
  const csvNet = rows.reduce((total, row) => total + Number(row[6]), 0);

  const revenue = (await (await call(`/api/revenue?${RANGE}`, acmeCookie)).json()) as { revenue_cents: number };
  assert.equal(csvNet, revenue.revenue_cents);
});

test('export: hostile field values survive a round-trip and cannot run as formulas', async () => {
  const rows = parseCsv(await csvText(await call(`/api/orders/export.csv?${RANGE}`, acmeCookie))).slice(1);

  // Commas, quotes and newlines come back exactly as stored.
  assert.equal(rows[1]![2], 'Doe, "Jane"\nsecond@example.com');
  // The formula is neutralised with a leading apostrophe.
  assert.equal(rows[2]![2], '\'=HYPERLINK("http://evil","click")');
});

test('export: names the downloaded file after the merchant and range', async () => {
  const response = await call('/api/orders/export.csv?from=2026-06-01&to=2026-06-04', acmeCookie);
  assert.equal(
    response.headers.get('Content-Disposition'),
    'attachment; filename="orders-m_acme-2026-06-01_2026-06-04.csv"',
  );
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('export: honours the date range', async () => {
  const rows = parseCsv(await csvText(await call('/api/orders/export.csv?from=2026-06-02&to=2026-06-03', acmeCookie))).slice(1);
  assert.deepEqual(rows.map((r) => r[0]), ['exp-2']);
});

test('export: half a range is rejected instead of silently ignored', async () => {
  const response = await call('/api/orders/export.csv?from=2026-06-01', acmeCookie);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error: string }).error, 'invalid_date_range');
});

test('export: without a range it returns the whole history', async () => {
  const rows = parseCsv(await csvText(await call('/api/orders/export.csv', acmeCookie))).slice(1);
  assert.equal(rows.length, 3);
});
