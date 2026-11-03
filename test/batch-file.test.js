// Offline tests for reading uploaded wallet lists and writing the result file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { readAddressColumn, buildResultXlsx, FileFormatError } from '../public/batch-file.js';

const encode = (text) => new TextEncoder().encode(text);
const WALLET_A = '0x26910A69d584307046C2E42a3F0Cb6fDe85764ee';
const WALLET_B = '0x9b641494c2e579bBaae5cfd72AF0394a74C634c2';

test('reads the first field of each non-empty CSV line', async () => {
  const csv = `﻿${WALLET_A}\r\n\r\n"${WALLET_B}"\n0xabc;note\n  \nlast`;
  assert.deepEqual(await readAddressColumn('list.CSV', encode(csv)), [WALLET_A, WALLET_B, '0xabc', 'last']);
});

test('reads the first tab of an .xlsx, skipping empty rows', async () => {
  // Written by exceljs: the first tab is not sheet1.xml, one cell is rich
  // text, and one row has its value in column B.
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/addresses.xlsx', import.meta.url)));
  assert.deepEqual(await readAddressColumn('addresses.xlsx', bytes), [
    WALLET_A,
    WALLET_B,
    '0xE1bb3B4F9E370FBb1c1Be46F4B14f3a152c184ef',
    'abc & <xyz>',
    '12345',
  ]);
});

test('rejects other formats and files that are not a zip', async () => {
  await assert.rejects(readAddressColumn('list.txt', encode(WALLET_A)), FileFormatError);
  await assert.rejects(readAddressColumn('list.xlsx', encode(WALLET_A)), FileFormatError);
});

test('writes an .xlsx with amounts as numbers and text as inline strings', async () => {
  const staking = [{ label: 'Staking 6 months', pool: '0xpool', staked: '0' }];
  const bytes = await buildResultXlsx([
    {
      input: WALLET_A,
      wallets: [{ address: WALLET_A, isInput: true, balance: '12.345', staking, totalStaked: '0' }],
      redemption: null,
    },
    { input: '=1+1 & <b>', error: 'Invalid wallet address' },
  ]);
  // Our own reader resolves the workbook back to its first column.
  assert.deepEqual(await readAddressColumn('result.xlsx', bytes), ['Wallet address', WALLET_A, '=1+1 & <b>']);

  // Inflate the sheet with zlib, independently of the module's zip code. Its
  // name first appears in its local header, right after the 30 fixed bytes.
  const view = Buffer.from(bytes);
  const header = view.indexOf('xl/worksheets/sheet1.xml') - 30;
  const start = header + 30 + view.readUInt16LE(header + 26) + view.readUInt16LE(header + 28);
  const sheet = inflateRawSync(view.subarray(start, start + view.readUInt32LE(header + 18))).toString();
  // A number cell, which every locale displays with its own decimal separator.
  assert.match(sheet, /<c r="C2"><v>12\.345<\/v><\/c>/);
  // Text stays a string, escaped, and is never evaluated as a formula.
  assert.match(sheet, /<c r="A3" t="inlineStr"><is><t>=1\+1 &amp; &lt;b&gt;<\/t><\/is><\/c>/);
});

test('result sheet sums both wallets and gives each wallet a Total', async () => {
  const staking = (staked) => [{ label: 'Staking 6 months', pool: '0xpool', staked }];
  const bytes = await buildResultXlsx([{
    input: WALLET_A,
    wallets: [
      { address: WALLET_A, isInput: true, balance: '1.1', staking: staking('2'), totalStaked: '2' },
      { address: WALLET_B, isInput: false, balance: '0.2', staking: staking('0.5'), totalStaked: '0.5' },
    ],
    redemption: null,
  }]);
  const view = Buffer.from(bytes);
  const header = view.indexOf('xl/worksheets/sheet1.xml') - 30;
  const start = header + 30 + view.readUInt16LE(header + 26) + view.readUInt16LE(header + 28);
  const sheet = inflateRawSync(view.subarray(start, start + view.readUInt32LE(header + 18))).toString();
  const header1 = [...sheet.matchAll(/<c r="([A-Z]+)1" t="inlineStr"><is><t>(.*?)<\/t>/g)].map((m) => [m[2], m[1]]);
  const column = Object.fromEntries(header1);
  const value = (name) => sheet.match(new RegExp(`<c r="${column[name]}2"><v>(.*?)</v>`))[1];
  assert.equal(value('Wallet balance'), '1.3');
  assert.equal(value('Total staked'), '2.5');
  assert.equal(value('Total (this wallet)'), '3.1');
  assert.equal(value('Total (paired wallet)'), '0.7');
});
