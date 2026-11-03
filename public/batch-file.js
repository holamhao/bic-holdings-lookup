// Reads the wallet list from an uploaded .csv/.xlsx and writes the result .xlsx.
// Plain ES module shared by index.html and the Node tests: it needs only
// TextDecoder, Blob, Response and (De)CompressionStream, which modern browsers
// and Node 22 all provide, so .xlsx support adds no dependency.
import { sumAmounts } from './amounts.js';

export const MAX_FILE_ROWS = 1000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
// Must not exceed MAX_BATCH_ADDRESSES in lib/config.js.
export const BATCH_CHUNK_SIZE = 50;

// The same rule the server applies (viem isAddress, non-strict).
export const isAddressLike = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);

export class FileFormatError extends Error {}

/**
 * First non-empty cell of every row, trimmed; empty rows are skipped.
 * @param {string} fileName decides the format by extension
 * @param {Uint8Array} bytes file content
 * @returns {Promise<string[]>}
 */
export async function readAddressColumn(fileName, bytes) {
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'csv') return readCsvColumn(bytes);
  if (extension === 'xlsx') return readXlsxColumn(bytes);
  throw new FileFormatError('Only .csv and .xlsx files are supported.');
}

function readCsvColumn(bytes) {
  // TextDecoder drops a leading UTF-8 BOM by default.
  const text = new TextDecoder().decode(bytes);
  return text.split(/\r\n|\n|\r/).map(firstCsvField).filter(Boolean);
}

function firstCsvField(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return trimmed.slice(1, end < 0 ? undefined : end).trim();
  }
  // Accept the separators Excel uses across locales.
  return trimmed.split(/[,;\t]/)[0].trim();
}

// --- .xlsx: a zip of XML parts -------------------------------------------

async function readXlsxColumn(bytes) {
  const zip = readZipDirectory(bytes);
  const readText = async (name) => {
    const entry = zip.get(name);
    return entry ? new TextDecoder().decode(await inflateEntry(bytes, entry)) : null;
  };
  const sheetXml = await readText(await firstSheetPath(readText));
  if (!sheetXml) throw new FileFormatError('The .xlsx file has no sheets.');
  const sharedStrings = parseSharedStrings((await readText('xl/sharedStrings.xml')) ?? '');

  const rows = [];
  for (const [, rowXml = ''] of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    for (const [, attributes, cellXml = ''] of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = cellValue(attributes, cellXml, sharedStrings).trim();
      if (value) {
        rows.push(value);
        break;
      }
    }
  }
  return rows;
}

// The first tab is the first <sheet> in workbook.xml, whose relationship id
// points at its part; it is not always sheet1.xml.
async function firstSheetPath(readText) {
  const workbook = (await readText('xl/workbook.xml')) ?? '';
  const relationships = (await readText('xl/_rels/workbook.xml.rels')) ?? '';
  const sheetTag = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '';
  const relationshipId = /\s\w+:id="([^"]+)"/.exec(sheetTag)?.[1];
  const relationshipTag = [...relationships.matchAll(/<Relationship\b[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`Id="${relationshipId}"`));
  const target = relationshipTag && /\bTarget="([^"]+)"/.exec(relationshipTag)?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, item]) => textRuns(item));
}

// Concatenates <t> runs (rich text splits a string into several), skipping
// phonetic hints in <rPh>.
function textRuns(xml) {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...withoutPhonetics.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => decodeXml(t)).join('');
}

function cellValue(attributes, cellXml, sharedStrings) {
  const type = /\bt="(\w+)"/.exec(attributes)?.[1];
  if (type === 'inlineStr') return textRuns(cellXml);
  const raw = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? '');
  return type === 's' ? sharedStrings[Number(raw)] ?? '' : raw;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text) =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, name) => {
    if (name[0] !== '#') return XML_ENTITIES[name] ?? match;
    return String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  });

// Reads entry locations from the zip central directory, which (unlike local
// headers) always carries the sizes.
function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isZip = bytes.length > 22 && view.getUint32(0, true) === 0x04034b50;
  // The end-of-central-directory record sits within the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; isZip && end < 0 && i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) end = i;
  }
  if (end < 0) {
    throw new FileFormatError('Could not read the .xlsx file. It may be corrupted, password-protected or an old .xls file.');
  }

  const entries = new Map();
  let offset = view.getUint32(end + 16, true);
  for (let i = view.getUint16(end + 10, true); i > 0; i--) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new FileFormatError('The .xlsx file is corrupted.');
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeader: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

async function inflateEntry(bytes, { method, compressedSize, localHeader }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
  const data = bytes.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method !== 8) throw new FileFormatError('The .xlsx file uses an unsupported compression method.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --- Result files ---------------------------------------------------------

/**
 * Columns of the result file: one row per uploaded row, with the figures the
 * page shows for a single lookup. `amount` marks token amounts, which the API
 * returns as exact decimal strings. "Wallet balance" and "Total staked" add up
 * the looked-up wallet and its paired wallet; each wallet's own detail follows,
 * ending with its "Total" (balance plus everything it has staked).
 * @param {Array<{input: string, error?: string, wallets?: object[], redemption?: object|null}>} results
 *   items shaped like /api/lookup-batch `results`
 * @param {number} decimals token decimals, for exact sums of the amount strings
 */
function resultColumns(results, decimals) {
  const poolLabels = results.find((r) => r.wallets)?.wallets[0].staking.map((s) => s.label) ?? [];
  const sumOf = (r, field) => (r.wallets ? sumAmounts(r.wallets.map((w) => w[field]), decimals) : undefined);
  const holderColumns = (suffix, holder) => [
    { header: `Wallet balance${suffix}`, amount: true, value: (r) => holder(r)?.balance },
    ...poolLabels.map((label, p) => ({ header: label + suffix, amount: true, value: (r) => holder(r)?.staking[p].staked })),
    {
      header: `Total${suffix}`, amount: true,
      value: (r) => (holder(r) ? sumAmounts([holder(r).balance, holder(r).totalStaked], decimals) : undefined),
    },
  ];
  return [
    { header: 'Wallet address', value: (r) => r.input },
    { header: 'Error', value: (r) => r.error },
    { header: 'Wallet balance', amount: true, value: (r) => sumOf(r, 'balance') },
    { header: 'Total staked', amount: true, value: (r) => sumOf(r, 'totalStaked') },
    ...holderColumns(' (this wallet)', (r) => r.wallets?.[0]),
    { header: 'Redemption contract', value: (r) => r.redemption?.contract },
    { header: 'Initial total', amount: true, value: (r) => r.redemption?.totalAmount },
    { header: 'Remaining unclaimed', amount: true, value: (r) => r.redemption?.remaining },
    { header: 'Claimable now', amount: true, value: (r) => r.redemption?.claimableNow },
    { header: 'Paired wallet', value: (r) => r.wallets?.[1]?.address },
    ...holderColumns(' (paired wallet)', (r) => r.wallets?.[1]),
  ];
}

/**
 * Result as .xlsx. Amounts are stored as real numbers, so Excel and Google
 * Sheets show them with the viewer's own decimal separator (a CSV "12.345"
 * would read as twelve thousand in a Vietnamese-locale Excel). Spreadsheet
 * numbers are doubles, so digits past ~15 significant ones are rounded.
 * @param {number} [decimals] token decimals of the amount strings
 * @returns {Promise<Uint8Array>}
 */
export async function buildResultXlsx(results, decimals = 18) {
  const columns = resultColumns(results, decimals);
  const cell = (ref, value, amount) => {
    if (value == null || value === '') return '';
    // Text goes in as an inline string, which a spreadsheet never evaluates.
    if (!amount) return `<c r="${ref}" t="inlineStr"><is><t>${encodeXml(String(value))}</t></is></c>`;
    return `<c r="${ref}"><v>${Number(value)}</v></c>`;
  };
  const rows = [
    columns.map((c, i) => cell(`${columnName(i)}1`, c.header, false)),
    ...results.map((r, n) => columns.map((c, i) => cell(`${columnName(i)}${n + 2}`, c.value(r), c.amount))),
  ];
  const widths = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.amount ? 18 : 45}" customWidth="1"/>`)
    .join('');
  const sheet = `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><cols>${widths}</cols><sheetData>${
    rows.map((cells, n) => `<row r="${n + 1}">${cells.join('')}</row>`).join('')
  }</sheetData></worksheet>`;

  return writeZip({
    '[Content_Types].xml': `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>',
    '_rels/.rels': relationships('officeDocument', 'xl/workbook.xml'),
    'xl/workbook.xml': `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${RELATIONSHIP_NS}">`
      + '<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': relationships('worksheet', 'worksheets/sheet1.xml'),
    'xl/worksheets/sheet1.xml': sheet,
  });
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const relationships = (type, target) =>
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${RELATIONSHIP_NS}/${type}" Target="${target}"/></Relationships>`;

const encodeXml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 0 -> A, 25 -> Z, 26 -> AA.
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Minimal zip writer: deflated entries, then the central directory that
// readZipDirectory above reads back.
async function writeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    // Version 2.0, UTF-8 names, deflate, time 00:00, date 1980-01-01.
    const fields = [[20, 2], [0x0800, 2], [8, 2], [0, 2], [0x21, 2],
      [crc32(data), 4], [compressed.length, 4], [data.length, 4], [nameBytes.length, 2], [0, 2]];
    localParts.push(littleEndian([[0x04034b50, 4], ...fields]), nameBytes, compressed);
    centralParts.push(
      littleEndian([[0x02014b50, 4], [20, 2], ...fields, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]),
      nameBytes,
    );
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const count = Object.keys(files).length;
  const end = littleEndian([[0x06054b50, 4], [0, 2], [0, 2], [count, 2], [count, 2], [centralSize, 4], [offset, 4], [0, 2]]);
  return new Uint8Array(await new Blob([...localParts, ...centralParts, end]).arrayBuffer());
}

function littleEndian(fields) {
  const bytes = new Uint8Array(fields.reduce((sum, [, size]) => sum + size, 0));
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const [value, size] of fields) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += size;
  }
  return bytes;
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
