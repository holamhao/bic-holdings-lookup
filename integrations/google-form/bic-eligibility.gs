/**
 * BIC eligibility check for every Google Form response.
 *
 * Attached to the Google Sheet that receives the form's responses. Each time
 * someone submits the form, the script calls the BIC Holdings Lookup
 * /api/lookup API and writes the total BIC and a status into 3 result columns.
 * Setup guide: docs/google-form-integration.md.
 *
 * Total BIC = the balance of every wallet in the result (the entered wallet and
 * the other beneficiary of its redemption) + what those wallets have staked +
 * the unclaimed redemption.
 */

// Column numbers count from 1 (A = 1, B = 2, ...). The script uses numbers
// rather than headers because a header changes with the form question's title.
const CONFIG = {
  API_URL: 'https://biclookup.vercel.app/api/lookup',
  MIN_BIC: '20000',
  // Column holding the wallet address. Column 1 is always the timestamp; if the
  // form collects email addresses, column 2 is the email and the address moves
  // to column 3.
  ADDRESS_COL: 2,
  // First of the 3 adjacent result columns, right after the form's last column.
  RESULT_COL: 10,
};

// Headers and statuses are written into the Sheet in Vietnamese, the form's
// language. Change them only on a new Sheet: ensureResultColumns rejects
// headers that differ, and recheckPending matches the ERROR status.
const RESULT_HEADERS = ['Tổng BIC', 'Trạng thái', 'Kiểm tra lúc'];
const STATUS = {
  ELIGIBLE: 'ĐỦ ĐIỀU KIỆN',
  NOT_ELIGIBLE: 'KHÔNG ĐỦ',
  INVALID: 'ĐỊA CHỈ SAI',
  ERROR: 'LỖI, CẦN KIỂM TRA LẠI',
};

/** Run once after pasting the script: writes the result headers and creates 2 triggers. */
function installTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  ensureResultColumns(getResponseSheet());
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (['handleFormSubmit', 'recheckPending'].includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger('handleFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();
  ScriptApp.newTrigger('recheckPending').timeBased().everyHours(1).create();
}

/** "On form submit" trigger: checks the row that was just added. */
function handleFormSubmit(e) {
  const sheet = e.range.getSheet();
  ensureResultColumns(sheet);
  checkRow(sheet, e.range.getRow());
}

/**
 * Rechecks rows with no result yet or with an error (a temporary RPC outage,
 * rows submitted before the script was installed). Runs hourly through a
 * trigger, or by hand.
 */
function recheckPending() {
  const sheet = getResponseSheet();
  ensureResultColumns(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const statuses = sheet.getRange(2, CONFIG.RESULT_COL + 1, lastRow - 1, 1).getValues();
  statuses.forEach(([status], i) => {
    if (status === '' || status === STATUS.ERROR) checkRow(sheet, i + 2);
  });
}

function checkRow(sheet, row) {
  const address = String(sheet.getRange(row, CONFIG.ADDRESS_COL).getValue()).trim();
  const result = checkWallet(address);
  sheet
    .getRange(row, CONFIG.RESULT_COL, 1, RESULT_HEADERS.length)
    .setValues([[result.total, result.status, new Date()]]);
}

function checkWallet(address) {
  let response;
  try {
    response = UrlFetchApp.fetch(`${CONFIG.API_URL}?address=${encodeURIComponent(address)}`, {
      muteHttpExceptions: true,
    });
  } catch (error) {
    console.error(`Could not call the API for ${address}: ${error}`);
    return { total: '', status: STATUS.ERROR };
  }

  const code = response.getResponseCode();
  if (code === 400) return { total: '', status: STATUS.INVALID };
  if (code !== 200) {
    console.error(`API returned ${code} for ${address}: ${response.getContentText()}`);
    return { total: '', status: STATUS.ERROR };
  }

  const report = JSON.parse(response.getContentText());
  const decimals = report.token.decimals;
  const total = totalBicUnits(report);
  return {
    // For display only; the threshold check below uses exact integers.
    total: Number(total) / 10 ** decimals,
    status: total >= toUnits(CONFIG.MIN_BIC, decimals) ? STATUS.ELIGIBLE : STATUS.NOT_ELIGIBLE,
  };
}

/** Total BIC in the smallest unit (BigInt), so the threshold check has no rounding error. */
function totalBicUnits(report) {
  const decimals = report.token.decimals;
  let total = 0n;
  for (const wallet of report.wallets) {
    total += toUnits(wallet.balance, decimals) + toUnits(wallet.totalStaked, decimals);
  }
  // "remaining" is the BIC still held by the redemption contract, which already
  // includes claimableNow, so claimableNow is not added again.
  if (report.redemption) total += toUnits(report.redemption.remaining, decimals);
  return total;
}

/** "1234.5" -> 1234500000000000000000n when decimals = 18. */
function toUnits(amount, decimals) {
  const [whole, fraction = ''] = String(amount).split('.');
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
}

function getResponseSheet() {
  const sheet = SpreadsheetApp.getActive().getSheets().find((s) => s.getFormUrl());
  if (!sheet) throw new Error('No sheet in this file receives form responses.');
  return sheet;
}

/**
 * Writes the 3 result headers where they are empty. If a column already has a
 * different header (usually a new form question that shifted the columns),
 * stops so people's answers are never overwritten.
 */
function ensureResultColumns(sheet) {
  const range = sheet.getRange(1, CONFIG.RESULT_COL, 1, RESULT_HEADERS.length);
  const current = range.getValues()[0];
  current.forEach((header, i) => {
    if (header !== '' && header !== RESULT_HEADERS[i]) {
      throw new Error(
        `Column ${CONFIG.RESULT_COL + i} has the header "${header}", not "${RESULT_HEADERS[i]}". ` +
          'Point CONFIG.RESULT_COL at 3 empty columns to the right of the form columns.',
      );
    }
  });
  if (current.some((header) => header === '')) range.setValues([RESULT_HEADERS]);
}
