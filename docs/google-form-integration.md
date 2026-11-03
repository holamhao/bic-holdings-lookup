# BIC eligibility check for Google Forms

People enter their wallet address in a Google Form. Right after they submit, an Apps Script attached to the form's response Google Sheet calls `/api/lookup` and writes the wallet's total BIC and a status onto the same row. Source: [`integrations/google-form/bic-eligibility.gs`](../integrations/google-form/bic-eligibility.gs).

## Eligibility rule

A wallet is eligible when the following total reaches at least **20,000 BIC**:

- the balance of the entered wallet and of the other beneficiary in its redemption contract (if any);
- what both wallets have staked;
- the unclaimed redemption (`redemption.remaining`, which already includes the part claimable now).

The threshold comparison uses exact integers at the token's `decimals`, so a wallet with 19,999.9999… BIC is never rounded up to eligible. The script does not ask the person to prove they own the wallet.

## Setup

1. **Deploy the web app** following the [README](README.md#deploying-for-free-on-vercel-hobby-plan) and note its domain. The current production build is `https://biclookup.vercel.app`.
2. **In Google Forms**, on the wallet address question turn on **Response validation → Regular expression → Matches** with `^0x[a-fA-F0-9]{40}$` to reject malformed addresses as people type.
3. **Link the form to a Google Sheet** (Responses tab → Sheets icon).
4. **In the Sheet**, open **Extensions → Apps Script**, delete the default code and paste the whole `bic-eligibility.gs` file.
5. **Edit `CONFIG`** at the top of the file:
   - `API_URL`: the domain from step 1, plus `/api/lookup`.
   - `ADDRESS_COL`: the number of the column holding the wallet address (A = 1). Column 1 is always the timestamp; if the form collects email addresses, the wallet address is usually in column 3.
   - `RESULT_COL`: the first of the 3 result columns, placed right after the form's last column.
6. **Run the `installTriggers` function** once (pick it in the toolbar and click Run) and grant the permissions Google asks for. It writes the 3 result column headers, creates a trigger that runs on every form submission, and creates a trigger that rechecks every hour. Running it again does not create duplicate triggers.

The triggers run as the account that clicked Run in step 6. If that account loses access to the Sheet, the script stops running.

## Results in the Sheet

The script writes Vietnamese column headers and status values, because the form it was built for is Vietnamese. To use other labels, edit `RESULT_HEADERS` and `STATUS` in the script before running `installTriggers` on a new Sheet; on a Sheet that already has results, changing them makes the header check fail and stops old error rows from being rechecked.

| Column | Contents |
|---|---|
| `Tổng BIC` (Total BIC) | The total under the rule above. Empty if the check has not succeeded yet |
| `Trạng thái` (Status) | `ĐỦ ĐIỀU KIỆN` (eligible), `KHÔNG ĐỦ` (not eligible), `ĐỊA CHỈ SAI` (invalid address) or `LỖI, CẦN KIỂM TRA LẠI` (error, needs a recheck) |
| `Kiểm tra lúc` (Checked at) | When the balances were read |

`LỖI, CẦN KIỂM TRA LẠI` means the API or the RPC did not answer at the time. The hourly `recheckPending` function checks these rows again, along with rows that have no status yet (for example responses submitted before the script was installed). You can also run it by hand at any time.

## Why column numbers instead of headers

A column header in the Sheet is the question's title, so it changes whenever someone edits the question in the form. A column's number does not change when questions are renamed or reordered.

When the form **gets a new question**, its column can land exactly where the result columns are. Before every write the script checks the headers of the 3 result columns. If one of them has a different header, the script stops with an error instead of overwriting people's answers. When you see this error under **Executions** in Apps Script, point `RESULT_COL` at 3 new empty columns.

## Limitations

- Balances are read at check time. A person can move tokens away after submitting the form.
- Two people sharing one redemption contract get the same total BIC, because the total covers both wallets.
- An Apps Script run lasts at most 6 minutes and each row takes about 1 second. If hundreds of rows fail at once, `recheckPending` may need several runs.
- The script reads the API fields `token.decimals`, `wallets[].balance`, `wallets[].totalStaked` and `redemption.remaining`. Renaming or restructuring these fields in `lib/bic-lookup.js` breaks the script.
