// Integration tests: they read live Arbitrum state, so balances are only
// checked for shape, while addresses and links between them are exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupWallet, lookupWallets, InvalidAddressError } from '../lib/bic-lookup.js';

const WALLET_A = '0x26910A69d584307046C2E42a3F0Cb6fDe85764ee';
const WALLET_B = '0x9b641494c2e579bBaae5cfd72AF0394a74C634c2';
const VESTING = '0xf39680D36260Fe3E3683e3011dD2750660F790D1';
const OPERATOR_EOA = '0xE1bb3B4F9E370FBb1c1Be46F4B14f3a152c184ef';
const DECIMAL = /^\d+(\.\d+)?$/;

test('finds the redemption contract and the other beneficiary', async () => {
  const report = await lookupWallet(WALLET_A.toLowerCase());
  assert.equal(report.token.symbol, 'BIC');
  assert.equal(report.redemption.contract, VESTING);
  assert.deepEqual(report.wallets.map((w) => w.address), [WALLET_A, WALLET_B]);
  assert.equal(report.wallets[0].isInput, true);
  for (const field of ['totalAmount', 'remaining', 'claimableNow']) {
    assert.match(report.redemption[field], DECIMAL);
  }
  assert.ok(Number(report.redemption.totalAmount) >= Number(report.redemption.remaining));
  // Wallet A has stakes in the 12- and 15-month pools.
  assert.ok(Number(report.wallets[0].totalStaked) > 0);
  assert.equal(report.wallets[0].staking.length, 4);
});

test('works the same when the second beneficiary is entered', async () => {
  const report = await lookupWallet(WALLET_B);
  assert.equal(report.redemption.contract, VESTING);
  assert.deepEqual(report.wallets.map((w) => w.address), [WALLET_B, WALLET_A]);
});

test('returns only the entered wallet when it has no redemption', async () => {
  const report = await lookupWallet(OPERATOR_EOA);
  assert.equal(report.redemption, null);
  assert.equal(report.wallets.length, 1);
  assert.match(report.wallets[0].balance, DECIMAL);
});

test('rejects malformed addresses before calling the RPC', async () => {
  await assert.rejects(lookupWallet('0x123'), InvalidAddressError);
  await assert.rejects(lookupWallet(''), InvalidAddressError);
});

test('looks up many wallets at once, keeping input order, duplicates and invalid rows', async () => {
  const inputs = [WALLET_A.toLowerCase(), OPERATOR_EOA, 'abc', WALLET_B, WALLET_A];
  const { token, results } = await lookupWallets(inputs);
  assert.equal(token.symbol, 'BIC');
  assert.deepEqual(results.map((r) => r.input), inputs);
  assert.equal(results[0].redemption.contract, VESTING);
  assert.deepEqual(results[0].wallets.map((w) => w.address), [WALLET_A, WALLET_B]);
  assert.equal(results[1].redemption, null);
  assert.equal(results[1].wallets.length, 1);
  assert.match(results[2].error, /Invalid wallet address/);
  // Both beneficiaries of one contract share its redemption figures.
  assert.deepEqual(results[3].redemption, results[0].redemption);
  assert.deepEqual(results[3].wallets.map((w) => w.address), [WALLET_B, WALLET_A]);
  assert.deepEqual(results[4].wallets, results[0].wallets);
  for (const field of ['balance', 'totalStaked']) assert.match(results[3].wallets[0][field], DECIMAL);
});
