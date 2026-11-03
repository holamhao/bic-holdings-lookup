# Technical reference

This is the detailed guide to how BIC Holdings Lookup works. For an overview, see the [project README](../README.md).

The tool takes a wallet address and reports its BIC balance on Arbitrum One, its redemption (vesting) contract if it has one along with the other beneficiary wallet, and the BIC each wallet has staked. Many wallets can be looked up at once by uploading a `.csv` or `.xlsx` file, and the results download as an Excel file.

The UI is in English and follows the Figma design word for word, including API error messages, staking pool labels and the result file's headers. The page has light and dark themes: the first visit follows the system setting, and the masthead toggle switches theme and remembers the choice in `localStorage` (key `bic-theme`).

## Where the data comes from

| Data | On-chain source |
|---|---|
| Wallet balance | `balanceOf(wallet)` on the BIC token `0xB1C3…8386` |
| Wallet's redemption contract | `redeemAddress(wallet)` on `BICVestingFactory` `0x8386…c999`. `0x0` means the wallet has no redemption |
| Other beneficiary wallet | `getBeneficiaries()` on the redemption contract |
| Initial total | `redeemTotalAmount()` |
| Remaining unclaimed | `balanceOf(redemption contract)` on the BIC token |
| Claimable now | First value of `releasable()`, exactly what `release()` would pay out if called now |
| Staked | Sum of `amount` over deposits with `withdrawn = false` from `getUserDeposits(wallet)` on each of the 4 staking pools |

The Redemption Operator wallet `0xE1bb…84ef` is the factory's owner. It is a regular wallet (EOA), not a contract. The contracts' source code is verified on [Sourcify](https://sourcify.dev).

Every address lives in [`lib/config.js`](../lib/config.js).

### Three multicall rounds

A lookup runs three sequential [Multicall3](https://www.multicall3.com/) rounds, because each round needs the previous one's result:

1. Token `symbol` and `decimals`, plus `redeemAddress` for every wallet.
2. For each distinct non-zero redemption contract: beneficiaries, initial total, `releasable()` and remaining balance.
3. For every distinct holder (entered wallets and other beneficiaries): `balanceOf` plus `getUserDeposits` on every staking pool.

Each round is a single `eth_call`, whether it covers one wallet or fifty.

## Batch lookup from a file

- The `.csv` or `.xlsx` file holds one column of wallet addresses with no header row. For `.xlsx`, the tool reads the first tab and takes the first non-empty cell of each row. Empty rows are skipped.
- At most **1,000 wallets** and **2 MB** per file. The file is parsed in the browser; the server only receives the address list.
- The browser sends groups of 50 wallets to `/api/lookup-batch` one after another, and looks up each distinct wallet only once even if it appears on several rows.
- The result file has one row per row of the uploaded file. It starts with `Wallet balance` and `Total staked` (summed over the entered wallet and the other beneficiary), followed by each wallet's detail (balance, stake per pool, and `Total` = balance + total staked) and the redemption contract. Rows with an invalid address or an RPC error give the reason in the `Error` column. Column headers and the sheet name (`Results`) are in English.
- The result is an `.xlsx` file rather than CSV. Token amounts are stored as numbers, so Excel and Google Sheets show them with the viewer's own decimal separator (`46.066,9` or `46,066.9`). With CSV, an Excel set to a comma-decimal locale would read `12.345` as twelve thousand. Spreadsheets keep about 15 significant digits and round the rest; use `/api/lookup-batch` when you need all 18 decimals.

Why these limits: a group of 50 wallets (plus their other beneficiaries) is at most about 500 reads, bundled into one `eth_call` through Multicall3, which takes about 1 second on the public RPC. A measured run of 1,000 wallets took 20 requests and about 15 seconds, with the slowest request at 1.2 seconds and no rate limiting, comfortably inside the Vercel Hobby function time limit. To change the limit, edit `MAX_FILE_ROWS` in [`public/batch-file.js`](../public/batch-file.js). `BATCH_CHUNK_SIZE` there must not exceed `MAX_BATCH_ADDRESSES` in `lib/config.js`.

## Lookup history

- The app has no database, so history lives only in the current browser's `localStorage` (key `bic-lookup-history`). Another device, another browser, a private window or clearing site data means the old history is not there.
- The **History** button in the masthead opens the history as a right-hand drawer (wide screens) or a bottom sheet (600px and below), with **Wallets** and **Files** tabs. Click the backdrop, the close button or press Esc to close it.
- A successful single-wallet lookup saves the address. Looking up the same wallet again (any letter case) moves the old entry to the top instead of duplicating it.
- A file lookup saves the file name and its number of address rows. Every upload is a separate entry. If the name is already in the history, the new one is numbered the way an OS names a duplicate file: `list.csv`, `list (1).csv`, `list (2).csv`, always taking the smallest free number and ignoring letter case.
- At most **50** recent lookups are kept (`HISTORY_LIMIT` in [`public/lookup-history.js`](../public/lookup-history.js)). Only addresses and times are stored, not balances, since balances change all the time.
- Clicking a wallet in the history closes the drawer and looks that wallet up again. File entries are read-only, because a page cannot reopen a file on the user's machine.
- The ✕ on each row removes one entry. The drawer footer has a "Clear wallets" or "Clear files" button (depending on the open tab); clicking it turns the footer into an inline confirmation (Cancel / Clear) that removes only that tab's entries and leaves the other tab alone.

## UI and static assets

- The page is a single static [`public/index.html`](../public/index.html) with no build step. Newsreader, Be Vietnam Pro and JetBrains Mono load from Google Fonts; if they load slowly, text still renders in fallback fonts.
- Icons are SVG files exported from Figma and kept unmodified in [`public/assets/icons/`](../public/assets/icons/). The page draws them with CSS `mask-image` in `currentColor`, so one file works in both themes. To add an icon, export it from Figma into that folder and add one `.icon-<name>` rule to the CSS.
- The redemption contract's vesting progress bar is computed in [`public/redemption-progress.js`](../public/redemption-progress.js): claimed = initial total − remaining, claimable = `releasable()`, locked = remaining − claimable. The subtraction runs on big integers, so no precision is lost.

## Running locally

Requires Node.js 22 or later.

```bash
npm install
npm run dev      # opens http://localhost:3000
npm test         # integration tests against live Arbitrum data, plus offline tests for files, history and the vesting bar
```

By default the tool uses the public RPC `https://arb1.arbitrum.io/rpc`. To switch to Alchemy or Infura, set the `ARBITRUM_RPC_URL` environment variable. Never put a key in the code.

## Deploying for free on Vercel (Hobby plan)

The current production build is https://biclookup.vercel.app (Vercel project `bic-token`). Update it with `npx vercel --prod` from the project folder.

1. Push the project to GitHub.
2. On vercel.com, choose **Add New → Project**, import the repo, set Framework Preset to **Other** and keep the default build settings.
3. (Optional) Under **Settings → Environment Variables**, add `ARBITRUM_RPC_URL`.
4. Click Deploy. Vercel serves the `public/` folder (`index.html` at `/`) and runs the files in `api/` as serverless functions at `/api/lookup` and `/api/lookup-batch`.
5. Check after deploying: `https://<app>.vercel.app/CLAUDE.md` must return 404, which means only `public/` is served.

`vercel.json` only declares security headers (CSP, `X-Frame-Options`, `nosniff`, ...) for every path. The CSP allows scripts and styles from the site itself (inline included), fonts from Google Fonts and `fetch` to the site itself, so loading anything from another domain means editing the CSP in that file. `.vercelignore` keeps `plans/`, `docs/`, `test/`, `integrations/` and dev-only files out of the upload.

Instead of GitHub, you can also run `npx vercel` directly in the project folder.

## API

`GET /api/lookup?address=0x...`

- `200`: `{ token, wallets[], redemption | null }`. Token amounts are decimal strings already divided by `decimals`.
- `400`: invalid address (message: `Invalid wallet address: …`).
- `502`: failed to read from the RPC.

`GET /api/lookup-batch?addresses=0x...,0x...`

- At most 50 comma-separated addresses.
- `200`: `{ token, results[] }`, in the order sent: each item is `{ input, wallets, redemption }` as in `/api/lookup`, or `{ input, error }` for an invalid address.
- `400`: `addresses` missing or more than 50 addresses.
- `502`: failed to read from the RPC.

Successful responses carry `Cache-Control: public, s-maxage=15`, so Vercel's CDN can reuse an answer for 15 seconds.

## Google Form integration

An Apps Script attached to a Google Sheet checks whether a wallet holds at least 20,000 BIC each time someone submits a form: see [google-form-integration.md](google-form-integration.md).
