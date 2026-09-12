import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalConnection, isLocalHostname, isLoopbackAddress } from '../src/auth/local.js';

test('local: loopback addresses are recognised', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.53'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.4'), false);
  assert.equal(isLoopbackAddress('203.0.113.9'), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test('local: localhost hostnames are recognised, with or without port', () => {
  assert.equal(isLocalHostname('localhost:3000'), true);
  assert.equal(isLocalHostname('127.0.0.1:3055'), true);
  assert.equal(isLocalHostname('[::1]:3000'), true);
  assert.equal(isLocalHostname('dashboard.example.com'), false);
  assert.equal(isLocalHostname(undefined), false);
});

test('local: a spoofed Host header from a remote peer is not local', () => {
  // The Host header is client-controlled; the TCP peer address is what decides.
  assert.equal(isLocalConnection('203.0.113.9', 'localhost:3000'), false);
  assert.equal(isLocalConnection('127.0.0.1', 'dashboard.example.com'), false);
  assert.equal(isLocalConnection('127.0.0.1', 'localhost:3000'), true);
});
