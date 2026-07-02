# Development Compass

Use this file as the short working guide for PEPEW Light Wallet development.

## Priority

The current priority is a safe public non-custodial web wallet served at `/wallet/` and backed by PEPEW Light API.

Focus areas:

1. safety warning and import flow
2. fast static loading and correct asset paths
3. balance/history/QR display
4. friendly error handling
5. API status visibility
6. deployment stability
7. signed raw transaction broadcast only after the send flow is reviewed

## Non-negotiable security rules

- Recovery material stays client-side.
- Server never signs transactions.
- Server never stores wallet secrets.
- API calls contain only addresses, txids, read options, or signed raw transactions.
- ElectrumX is not exposed directly.
- Public wallet must clearly state that it is non-custodial.

## Active code areas

```text
apps/web/src/components/     reusable UI
apps/web/src/pages/          route/page-level wallet screens
apps/web/src/lib/            PEPEW Light API client and utilities
apps/web/src/wallet/         wallet integration logic when present
packages/wallet-core/        derivation/address/transaction helpers
```

## Backend boundary

Do not add backend behavior to this repo. The API gateway is maintained in:

```text
pepepow-electrumx-service
```

Wallet API contract:

```text
GET  /api/wallet/address/{address}
GET  /api/wallet/history/{address}
GET  /api/wallet/utxo/{address}
GET  /api/wallet/tx/{txid}
POST /api/wallet/broadcast
```

## Development commands

```bash
npm install
npm --prefix packages/wallet-core install
npm --prefix apps/web install
npm run build
npm run dev
```

Checks:

```bash
npm run test:client
npm run test:amount
npm run test:uint64
npm run scan:readonly-api
```

## Before each deploy

- `npm run build` passes.
- `/wallet/` static base path works.
- Logo and assets load from `/wallet/assets/...`.
- API client points to same-origin `/api/wallet/*` in production.
- Import flow warns user before entering recovery phrase.
- Balance and history display for a known address.
- Invalid address, timeout, rate limit, and API unavailable cases are readable.
- No old `pepepow-wallet-suite`, trade bot, Telegram auth, or exchange docs are reintroduced into active README links.

## Do not add

- custodial wallet server
- backend mnemonic import
- backend derivation or signing
- direct browser-to-ElectrumX connection
- exchange trading bot code
- Telegram wallet control plane code
- analytics that associates addresses with users long term
