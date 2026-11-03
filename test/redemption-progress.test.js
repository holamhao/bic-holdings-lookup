// Offline tests for the vesting progress split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redemptionProgress } from '../public/redemption-progress.js';

test('subtracts 18-decimal amounts exactly', () => {
  const progress = redemptionProgress({
    totalAmount: '120000.123456789012345678',
    remaining: '46066.900000000000000001',
    claimableNow: '3412.5',
  }, 18);
  assert.equal(progress.claimed, '73933.223456789012345677');
  assert.equal(progress.claimable, '3412.5');
  assert.equal(progress.locked, '42654.400000000000000001');
});

test('percentages add up to 100 and follow the amounts', () => {
  const progress = redemptionProgress({ totalAmount: '120000', remaining: '46066.9', claimableNow: '3412.5' }, 18);
  assert.equal(progress.claimedPct, 61.61);
  assert.equal(progress.claimablePct, 2.84);
  assert.equal(Math.round((progress.claimedPct + progress.claimablePct + progress.lockedPct) * 100), 10_000);
  assert.equal(progress.claimedShare, 0.6161);
});

test('a zero total gives zero everywhere', () => {
  const progress = redemptionProgress({ totalAmount: '0', remaining: '0', claimableNow: '0' }, 18);
  assert.deepEqual(progress, {
    claimed: '0', claimable: '0', locked: '0', claimedPct: 0, claimablePct: 0, lockedPct: 0, claimedShare: 0,
  });
});

test('claimable above remaining and remaining above total are clamped', () => {
  const clampedClaimable = redemptionProgress({ totalAmount: '100', remaining: '40', claimableNow: '70' }, 18);
  assert.equal(clampedClaimable.claimable, '40');
  assert.equal(clampedClaimable.locked, '0');
  assert.equal(clampedClaimable.claimed, '60');

  const clampedRemaining = redemptionProgress({ totalAmount: '100', remaining: '130', claimableNow: '0' }, 18);
  assert.equal(clampedRemaining.claimed, '0');
  assert.equal(clampedRemaining.locked, '100');
  assert.equal(clampedRemaining.lockedPct, 100);
});

test('everything claimed leaves the bar fully claimed', () => {
  const progress = redemptionProgress({ totalAmount: '50', remaining: '0', claimableNow: '0' }, 18);
  assert.equal(progress.claimed, '50');
  assert.equal(progress.claimedPct, 100);
  assert.equal(progress.lockedPct, 0);
});
