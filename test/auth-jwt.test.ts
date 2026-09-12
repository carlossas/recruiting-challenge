process.env.JWT_SECRET ??= 'test-secret-for-jwt';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidTokenError, issueAdminToken, issueMerchantToken, signToken, verifyToken } from '../src/auth/jwt.js';

test('jwt: admin token carries the mint scope and no merchant', async () => {
  const { token } = await issueAdminToken('5m');
  const verified = await verifyToken(token);
  assert.equal(verified.role, 'admin');
  assert.equal(verified.scope, 'mint');
  assert.equal(verified.merchantId, undefined);
});

test('jwt: merchant token carries the data scope and its merchant', async () => {
  const { token, expiresAt } = await issueMerchantToken('m_acme', '5m');
  const verified = await verifyToken(token);
  assert.equal(verified.role, 'merchant');
  assert.equal(verified.scope, 'data');
  assert.equal(verified.merchantId, 'm_acme');
  assert.ok(expiresAt.getTime() > Date.now());
});

test('jwt: expired tokens are rejected', async () => {
  const token = await signToken({ role: 'merchant', scope: 'data', merchantId: 'm_acme' }, '-1s');
  await assert.rejects(() => verifyToken(token), InvalidTokenError);
});

test('jwt: tampered tokens are rejected', async () => {
  const { token } = await issueMerchantToken('m_acme', '5m');
  const [header, payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ role: 'merchant', scope: 'data', merchantId: 'm_bistro' })).toString(
    'base64url',
  );
  await assert.rejects(() => verifyToken(`${header}.${forged}.${signature}`), InvalidTokenError);
  assert.ok(payload);
});

test('jwt: garbage is rejected', async () => {
  await assert.rejects(() => verifyToken('not-a-token'), InvalidTokenError);
});
