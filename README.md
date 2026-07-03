# PEPEW Light Wallet

PEPEW Light Wallet is a client-side, non-custodial PEPEPOW web wallet.
It uses PEPEW Light API for balance, history, UTXO, and transaction lookups.
Mnemonic/private keys are handled only in the browser.

## Public Beta Notice

This is a public beta release. Only read-only wallet queries (balance, history, QR) are currently enabled. Transaction signing and broadcasting is temporarily disabled during beta validation.

## Current focus

Phase 4.5 / Phase 5 development focuses on making the public ElectrumX-based web wallet safe and usable:

- fast `/wallet/` static loading
- balance and history display through PEPEW Light API
- receive address and QR display
- mnemonic import UX polish
- clear non-custodial safety warnings in English and Chinese
- friendly API / address / network error handling
- signed raw transaction broadcast only after the send flow is reviewed

## Security boundary

This project is non-custodial.

- Mnemonics and private keys must stay in the browser/client only.
- The server must never receive, store, log, derive, or sign with private keys.
- Address lookup, history, UTXO, transaction lookup, and future broadcast use the PEPEW Light API.
- Broadcast must submit only an already-signed raw transaction.
- The API gateway is `pepepow-electrumx-service`; it must not contain mnemonic, private-key, or signing code.

> Warning: any website that asks for a mnemonic can steal funds. Users must verify the official domain before importing a wallet.

## Architecture

```text
User Browser
  └─ PEPEW Light Wallet (Vite / React)
       ├─ mnemonic import / local derivation / local signing
       ├─ balance, history, UTXO, tx lookup
       └─ future signed raw tx broadcast
            ↓ HTTPS same-origin
Nginx / static wallet / reverse proxy
            ↓
PEPEW Light API (FastAPI, pepepow-electrumx-service)
            ↓ private localhost only
ElectrumX
            ↓
PEPEPOWd
```

Repository split:

- `pepepow-light-wallet`: frontend wallet and client-side wallet logic only.
- `pepepow-electrumx-service`: FastAPI gateway, cache, status pages, read-only wallet API, and future signed-tx broadcast endpoint.
- `electrumx-pepepow`: ElectrumX chain support only.

## Repository layout

```text
apps/web/                 Vite + React web wallet
  src/                    UI, pages, services, wallet integration
  src/lib/pepewLightClient.ts
                          PEPEW Light API client
packages/wallet-core/     PEPEPOW address / derivation / transaction helpers
docs/                     Current wallet architecture, API integration, security, deployment notes
ops/                      Optional operational scripts/tests
```

Old `pepepow-wallet-suite` material such as trading bots, Telegram wallet control plane, and standalone `pepew-api` service documentation is intentionally not part of this repo's active scope.

## Requirements

- Node.js 20 LTS or newer
- npm
- PEPEW Light API reachable at `https://light.pepepow.net`

## Local development

```bash
git clone https://github.com/edisontw/pepepow-light-wallet.git
cd pepepow-light-wallet
npm install
npm --prefix packages/wallet-core install
npm --prefix apps/web install
npm run build
npm --prefix apps/web run dev
```

The Vite dev server uses `apps/web/vite.config.ts` and serves the wallet under `/wallet/`.

## Configuration

Production defaults to same-origin API calls:

```text
/api/wallet/address/{address}
/api/wallet/history/{address}
/api/wallet/utxo/{address}
/api/wallet/tx/{txid}
/api/wallet/broadcast
```

For development against a different PEPEW Light API host, set:

```bash
VITE_PEPEW_LIGHT_API_BASE_URL=https://light.pepepow.net
```

Do not point the public wallet at legacy `api.pepepow.net` routes unless a compatibility layer has been explicitly reviewed.

## Build and checks

```bash
npm run build
npm --prefix apps/web run test:client
npm --prefix apps/web run test:amount
npm --prefix packages/wallet-core run test:uint64
npm --prefix apps/web run scan:readonly-api
```

Important checks before deployment:

- no mnemonic/private-key/signing data is sent to the API
- static assets resolve correctly under `/wallet/`
- balance and history load from PEPEW Light API
- API unavailable / invalid address / timeout errors show user-friendly messages
- non-custodial warning is visible before or during mnemonic import

## Production Deployment

Production wallet:

https://light.pepepow.net/wallet/

Production API:

https://light.pepepow.net/api/wallet/*

This wallet is deployed under `/wallet/`, so Vite must use:

```ts
base: '/wallet/'
```

For production, the wallet should use same-origin API paths.
For local development, set:

```env
VITE_PEPEW_LIGHT_API_BASE_URL=http://localhost:8000
```

## Non-custodial Security Notice

PEPEW Light Wallet is non-custodial.
Your mnemonic and private keys stay in your browser.
Never share your recovery phrase with anyone.
PEPEW Light API cannot recover your wallet.

PEPEW Light Wallet 是非託管錢包。
助記詞與私鑰只會保存在你的瀏覽器中。
請勿將助記詞提供給任何人。
PEPEW Light API 無法協助找回錢包。

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [PEPEW Light API integration](docs/pepew-api.md)
- [Deployment layout](docs/deploy_layout.md)
- [Development compass](docs/DEV_COMPASS.md)
