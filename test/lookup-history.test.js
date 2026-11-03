// Offline tests for the browser-only lookup history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addHistoryEntry, removeHistoryEntry, clearHistoryType, formatHistoryTime, formatDateTime, parseHistory, walletEntry, fileEntry, HISTORY_LIMIT,
} from '../public/lookup-history.js';

const WALLET_A = '0x26910A69d584307046C2E42a3F0Cb6fDe85764ee';
const WALLET_B = '0x9b641494c2e579bBaae5cfd72AF0394a74C634c2';

test('adds new entries to the top', () => {
  const entries = addHistoryEntry([walletEntry(WALLET_A, 1)], fileEntry('list.xlsx', 12, 2));
  assert.deepEqual(entries, [fileEntry('list.xlsx', 12, 2), walletEntry(WALLET_A, 1)]);
});

test('moves a repeated wallet (any case) to the top instead of duplicating it', () => {
  let entries = [walletEntry(WALLET_B, 3), fileEntry('list.xlsx', 12, 2), walletEntry(WALLET_A, 1)];
  entries = addHistoryEntry(entries, walletEntry(WALLET_A.toLowerCase(), 4));
  assert.deepEqual(entries, [walletEntry(WALLET_A.toLowerCase(), 4), walletEntry(WALLET_B, 3), fileEntry('list.xlsx', 12, 2)]);
});

test('numbers a repeated file name like saving a file whose name is taken', () => {
  let entries = [];
  for (const [i, name] of ['list.csv', 'list.csv', 'LIST.csv', 'notes', 'notes'].entries()) {
    entries = addHistoryEntry(entries, fileEntry(name, 1, i));
  }
  assert.deepEqual(entries.map((e) => e.fileName), ['notes (1)', 'notes', 'LIST (2).csv', 'list (1).csv', 'list.csv']);

  // A freed number is reused, as the operating system does.
  entries = removeHistoryEntry(entries, entries.find((e) => e.fileName === 'list (1).csv'));
  entries = addHistoryEntry(entries, fileEntry('list.csv', 1, 9));
  assert.equal(entries[0].fileName, 'list (1).csv');
  assert.equal(entries.filter((e) => e.type === 'file').length, 5);
});

test(`keeps only the ${HISTORY_LIMIT} most recent entries`, () => {
  let entries = [];
  for (let i = 0; i <= HISTORY_LIMIT; i += 1) entries = addHistoryEntry(entries, fileEntry(`f${i}.csv`, 1, i));
  assert.equal(entries.length, HISTORY_LIMIT);
  assert.equal(entries[0].fileName, `f${HISTORY_LIMIT}.csv`);
  assert.equal(entries.at(-1).fileName, 'f1.csv');
});

test('removes one entry', () => {
  const entries = [walletEntry(WALLET_B, 2), walletEntry(WALLET_A, 1)];
  assert.deepEqual(removeHistoryEntry(entries, walletEntry(WALLET_B, 2)), [walletEntry(WALLET_A, 1)]);
});

test('clears only the entries of one type, keeping the order of the rest', () => {
  const entries = [walletEntry(WALLET_B, 4), fileEntry('b.csv', 2, 3), walletEntry(WALLET_A, 2), fileEntry('a.csv', 1, 1)];
  assert.deepEqual(clearHistoryType(entries, 'wallet'), [fileEntry('b.csv', 2, 3), fileEntry('a.csv', 1, 1)]);
  assert.deepEqual(clearHistoryType(entries, 'file'), [walletEntry(WALLET_B, 4), walletEntry(WALLET_A, 2)]);
  assert.deepEqual(clearHistoryType([], 'wallet'), []);
});

test('reads back stored history and drops malformed data', () => {
  const stored = [walletEntry(WALLET_A, 1), fileEntry('list.csv', 3, 2)];
  assert.deepEqual(parseHistory(JSON.stringify(stored)), stored);
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory('not json'), []);
  assert.deepEqual(parseHistory('{"type":"wallet"}'), []);
  assert.deepEqual(parseHistory(JSON.stringify([
    walletEntry('<img src=x>', 1),
    walletEntry(WALLET_B, 9),
    fileEntry('', 3, 1),
    fileEntry('x.csv', 0, 1),
    { type: 'wallet', address: WALLET_A },
    { type: 'other', at: 1 },
  ])), [walletEntry(WALLET_B, 9)]);
});

test('formats history times as today, yesterday or a date', () => {
  const at = (month, day, hour, minute) => new Date(2026, month - 1, day, hour, minute).getTime();
  const now = at(10, 31, 12, 0);
  assert.equal(formatHistoryTime(at(10, 31, 10, 37), now), 'Today at 10:37');
  assert.equal(formatHistoryTime(at(10, 30, 16, 20), now), 'Yesterday at 16:20');
  assert.equal(formatHistoryTime(at(10, 28, 11, 5), now), 'Oct 28 at 11:05');
  assert.equal(formatHistoryTime(new Date(2025, 11, 31, 23, 59).getTime(), now), 'Dec 31, 2025 at 23:59');
  // Yesterday is a calendar day, not 24 hours ago.
  assert.equal(formatHistoryTime(at(10, 30, 23, 59), at(10, 31, 0, 1)), 'Yesterday at 23:59');
  assert.equal(formatDateTime(at(10, 31, 9, 5), true), 'Oct 31, 2026 at 09:05');
});
