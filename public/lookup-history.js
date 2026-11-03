// Lookup history kept in the browser only (the app has no database). Pure
// functions so the Node tests can import them; index.html owns localStorage.
import { isAddressLike } from './batch-file.js';

export const HISTORY_KEY = 'bic-lookup-history';
export const HISTORY_LIMIT = 50;

/**
 * Entries, newest first:
 *   { type: 'wallet', address, at }          one wallet looked up
 *   { type: 'file', fileName, count, at }    an uploaded file and its row count
 * `at` is a millisecond timestamp.
 */
export const walletEntry = (address, at = Date.now()) => ({ type: 'wallet', address, at });
export const fileEntry = (fileName, count, at = Date.now()) => ({ type: 'file', fileName, count, at });

// File names in the history are unique (see uniqueFileName), so the name
// identifies a file entry.
const entryKey = (entry) =>
  entry.type === 'wallet' ? `wallet:${entry.address.toLowerCase()}` : `file:${entry.fileName}`;

// Same rule as saving a file whose name is taken: "list.csv" becomes
// "list (1).csv", then "list (2).csv", using the smallest free number.
// Names compare case-insensitively, as on Windows.
export function uniqueFileName(fileName, takenNames) {
  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf('.');
  const [base, extension] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
  for (let n = 1; ; n += 1) {
    const candidate = `${base} (${n})${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// A wallet looked up again (any letter case) moves to the top instead of
// being duplicated. A file is always a new entry, numbered if its name is
// already in the history.
export function addHistoryEntry(entries, entry, limit = HISTORY_LIMIT) {
  if (entry.type === 'file') {
    const kept = entries.slice(0, limit - 1);
    const taken = kept.filter((e) => e.type === 'file').map((e) => e.fileName);
    return [{ ...entry, fileName: uniqueFileName(entry.fileName, taken) }, ...kept];
  }
  const key = entryKey(entry);
  return [entry, ...entries.filter((e) => entryKey(e) !== key)].slice(0, limit);
}

export function removeHistoryEntry(entries, entry) {
  const key = entryKey(entry);
  return entries.filter((e) => entryKey(e) !== key);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** 24-hour local time, "09:05". */
export const formatClock = (at) => {
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Local date and time, "Oct 28 at 11:05", or "Oct 28, 2025 at 11:05" with the year. */
export function formatDateTime(at, withYear = false) {
  const date = new Date(at);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}${withYear ? `, ${date.getFullYear()}` : ''}`;
  return `${day} at ${formatClock(at)}`;
}

/**
 * When an entry was saved, for the history list: "Today at 10:37",
 * "Yesterday at 16:20", otherwise "Oct 28 at 11:05" (with the year when it is
 * not the current one).
 */
export function formatHistoryTime(at, now = Date.now()) {
  const startOfDay = (time) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (daysAgo === 0) return `Today at ${formatClock(at)}`;
  if (daysAgo === 1) return `Yesterday at ${formatClock(at)}`;
  return formatDateTime(at, new Date(at).getFullYear() !== new Date(now).getFullYear());
}

// Drops every entry of one type ('wallet' or 'file'), keeping the order of the rest.
export const clearHistoryType = (entries, type) => entries.filter((e) => e.type !== type);

const isValidEntry = (e) =>
  Number.isFinite(e?.at) &&
  ((e.type === 'wallet' && isAddressLike(e.address)) ||
    (e.type === 'file' && typeof e.fileName === 'string' && e.fileName !== '' && Number.isInteger(e.count) && e.count > 0));

// Stored data can be edited by hand or written by an older version, so drop
// anything that is not a well-formed entry instead of failing the page.
export function parseHistory(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter(isValidEntry).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}
