# SoMAp SMS Worker (Mawasiliano) — Phase 2

A small Cloudflare Worker that sits between SoMAp and SwalaSMS.

- It holds the SwalaSMS keys. They are stored as Cloudflare secrets, never in this public repo.
- It checks the Google login, the school and the role before anything is sent.
- It keeps wallets, the ledger and SMS history in **Cloudflare D1**, a private database that only the Worker can reach.
- It only **reads** Firebase (staff profiles and school names). It never writes to Firebase, and it adds no new public data.

Modes: `dryrun` (nothing sent) → `sandbox` (SwalaSMS test key, nothing really sent) → `live` (locked in Phase 2).
The single exception is the **HQ pipe test**: one real SMS, sent with the live key, only to numbers listed in `HQ_TEST_NUMBERS`.

## Files

| File | What it does |
|---|---|
| `../shared/sms_core.js` | Phone rules, SMS part counting, templates, fee-reminder grouping. Shared with the browser. |
| `src/index.js` | Routes and CORS. |
| `src/auth.js` | Google login check, and school + role lookup (same rules as `login.html`). |
| `src/firebase.js` | Read-only Firebase access with the service account. |
| `src/db.js` | D1: settings, wallets and ledger (each wallet change is one atomic step). |
| `src/send.js` | Campaigns and 200-message chunks: checks, reserve, send, refund. |
| `src/gateway/` | `dryrun.js` and `swalasms.js` behind one interface. |
| `src/hq.js` | HQ-only tools. |
| `src/webhook.js` | Signed SwalaSMS delivery reports. |
| `schema.sql` | D1 tables. |
| `console/index.html` | Test console. Open it locally with `npm run console`. |
| `test/` | 26 tests: `npm test`. These use no internet and no real database. |

## One-time setup (Windows PowerShell, inside `sms-worker`)

Do these one at a time.

1. `npm install`: downloads Cloudflare's tool (wrangler) into `sms-worker/node_modules` only.
2. `npx wrangler login`: opens the browser so you can allow wrangler to use your Cloudflare account.
3. `npx wrangler d1 create somap-sms`: creates the private database. Copy the `database_id` it prints into `wrangler.toml`. The id is not a secret.
4. `npm run db:init`: creates the tables.
5. `npm run deploy`: publishes the Worker to `https://somap-sms.<your-subdomain>.workers.dev`. It does not touch somapv2i.com.
6. Add the secrets. Each command asks you to type the value, and nothing is saved in files.
   - `npx wrangler secret put HQ_EMAILS`: your HQ Gmail address(es), separated by commas.
   - `npx wrangler secret put HQ_TEST_NUMBERS`: your own test phone number(s).
   - `Get-Content "$HOME\Downloads\<service-account>.json" -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`. Delete the downloaded file afterwards.
   - `npx wrangler secret put SWALASMS_TEST_KEY`: the `swl_test_...` key.
   - Pipe test only: `npx wrangler secret put SWALASMS_LIVE_KEY`: the `swl_live_...` key. Afterwards you may remove it with `npx wrangler secret delete SWALASMS_LIVE_KEY` until Phase 7.

## Testing

- `npm test`: offline tests.
- `npm run console`, then open http://localhost:5500/sms-worker/console/. Enter the Worker URL and sign in with Google.

## Limits on the free plan

- **Workers:** 100,000 requests per day, and 10 ms of CPU per request. Each chunk is one gateway call plus a few database statements.
- **D1:** 5 GB storage, 5 million rows read and 100,000 rows written per day.
