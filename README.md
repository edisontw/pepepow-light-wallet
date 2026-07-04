# PEPEW Light Wallet

PEPEW Light Wallet is a client-side, non-custodial PEPEPOW web wallet served under:

```text
https://light.pepepow.net/wallet/
```

It uses PEPEW Light API for balance, history, UTXO, transaction lookup, and signed raw transaction broadcast. Mnemonic and private keys are handled only in the browser.

## Public beta notice

This is a public beta release. Small-amount send testing is working, including consecutive sends with automatic UTXO/indexer retry. Users should test with small amounts first.

## Current focus

Phase 4.5 / Phase 5 development focuses on making the public ElectrumX-based web wallet safe and usable:

- fast `/wallet/` static loading
- balance and history display through PEPEW Light API
- receive address and QR display
- mnemonic import UX polish
- clear non-custodial safety warnings
- friendly API / address / network error handling
- client-side transaction signing
- signed raw transaction broadcast only

## Security boundary

This project is non-custodial.

- Mnemonics and private keys must stay in the browser/client only.
- The server must never receive, store, log, derive, or sign with private keys.
- Address lookup, history, UTXO, transaction lookup, and broadcast use the PEPEW Light API.
- Broadcast must submit only an already-signed raw transaction.
- The API gateway is `pepepow-electrumx-service`; it must not contain mnemonic, private-key, or signing code.

> Warning: any website that asks for a mnemonic can steal funds. Users must verify the official domain before importing a wallet.

## Architecture

```text
User Browser
  └─ PEPEW Light Wallet (Vite / React)
       ├─ mnemonic import / local derivation / local signing
       ├─ balance, history, UTXO, tx lookup
       └─ signed raw tx broadcast
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
- `pepepow-electrumx-service`: FastAPI gateway, cache, status pages, wallet API, and signed-tx broadcast endpoint.
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
- send submits only signed raw tx
- API unavailable / invalid address / timeout errors show user-friendly messages
- non-custodial warning is visible before or during mnemonic import

## Production deployment

Production wallet:

```text
https://light.pepepow.net/wallet/
```

Production API:

```text
https://light.pepepow.net/api/wallet/*
```

Correct static deploy target:

```text
/var/www/pepew-light/wallet/
```

Build and deploy:

```bash
cd /home/ubuntu/pepepow-light-wallet
git pull origin main
export PATH="/home/ubuntu/node-dist/bin:$PATH"
rm -rf apps/web/dist
npm run build
sudo mkdir -p /var/www/pepew-light/wallet
sudo rsync -a --delete apps/web/dist/ /var/www/pepew-light/wallet/
sudo nginx -t
sudo systemctl reload nginx
```

This wallet is deployed under `/wallet/`, so Vite must use:

```ts
base: '/wallet/'
```

## Non-custodial security notice

PEPEW Light Wallet is non-custodial.
Your mnemonic and private keys stay in your browser.
Never share your recovery phrase with anyone.
PEPEW Light API cannot recover your wallet.

PEPEW Light Wallet 是非託管錢包。
助記詞與私鑰只會保存在你的瀏覽器中。
請勿將助記詞提供給任何人。
PEPEW Light API 無法協助找回錢包。

## Language and UI text

The default UI language is English.

The wallet supports language switching through the top-right language selector:

- English
- 中文
- Русский

Do not hard-code bilingual text in wallet components. UI strings should use the i18n dictionary so each selected language is displayed independently.

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [PEPEW Light API integration](docs/pepew-api.md)
- [Deployment layout](docs/deploy_layout.md)
- [Production deploy path](docs/deploy-light-pepepow-net.md)
- [Send beta test notes](docs/send-beta-test-notes.md)
- [Development compass](docs/DEV_COMPASS.md)
