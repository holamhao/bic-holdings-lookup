// Offline tests for the exact decimal-string arithmetic used by the result page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumAmounts } from '../public/amounts.js';

test('adds decimal strings without floating-point error', () => {
  assert.equal(sumAmounts(['0.1', '0.2'], 18), '0.3');
  assert.equal(sumAmounts(['1000.123456789012345678', '0.000000000000000002'], 18), '1000.12345678901234568');
});

test('an empty list and zero amounts give "0"', () => {
  assert.equal(sumAmounts([], 18), '0');
  assert.equal(sumAmounts(['0', '0'], 18), '0');
});

test('whole numbers keep no decimal part', () => {
  assert.equal(sumAmounts(['1500', '2500'], 18), '4000');
});
