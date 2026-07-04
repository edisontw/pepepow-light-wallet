# PEPEW Light Wallet Architecture

PEPEW Light Wallet is a client-side web wallet for PEPEPOW / PEPEW. The current public target is a static Vite/React wallet served from `/wallet/` and integrated with the PEPEW Light ElectrumX gateway.

## Design goals

- Keep the wallet non-custodial.
- Keep all wallet secret handling in the browser/client.
- Use PEPEW Light API for address, history, UTXO, transaction, and signed-broadcast calls.
- Keep ElectrumX and PEPEPOWd private behind the backend gateway.
- Build a lightweight wallet suitable for an Oracle Cloud single-core / 6 GB host when served with the existing node, ElectrumX, API, and static files.

## Runtime model

```text
Browser
  PEPEW Light Wallet
    - import mnemonic
    - derive addresses locally
    - display balance, history, receive QR
    - construct/sign transactions locally
    - submit only signed raw tx
        |
        | HTTPS /api/wallet/*
        v
Nginx
  - static /wallet/ files
  - reverse proxy /api/*
  - rate limiting and cache headers
        |
        v
PEPEW Light API
  FastAPI gateway from pepepow-electrumx-service
        |
        v
ElectrumX on localhost
        |
        v
PEPEPOWd
```

## Active components

### `apps/web`

Vite + React web wallet.

Responsibilities:

- wallet onboarding UI
- mnemonic import flow
- balance display
- transaction history display
- receive address and QR display
- send page and signed raw tx broadcast flow
- PEPEW Light API status/error display
- static build under `/wallet/`

### `packages/wallet-core`

Shared client-side wallet helpers.

Responsibilities:

- PEPEPOW address and derivation helpers
- transaction construction/signing helpers
- unit-testable wallet primitives

This package must remain frontend/client-side wallet logic. Do not add backend service behavior here.

### `apps/web/src/lib/pepewLightClient.ts`

PEPEW Light API client.

Current API paths:

```text
GET  /api/wallet/address/{address}
GET  /api/wallet/history/{address}
GET  /api/wallet/utxo/{address}
GET  /api/wallet/tx/{txid}
POST /api/wallet/broadcast
```

Production defaults to same-origin calls. `VITE_PEPEW_LIGHT_API_BASE_URL` is only needed for local development or staging.

## Repository boundaries

| Repository | Responsibility |
| --- | --- |
| `pepepow-light-wallet` | Static web wallet and client-side wallet logic |
| `pepepow-electrumx-service` | FastAPI gateway, API cache, status pages, wallet API, signed-tx broadcast endpoint |
| `electrumx-pepepow` | ElectrumX chain support only |

Do not add wallet custody or server-side signing behavior to the backend gateway.

## Data allowed to cross the API boundary

Allowed:

- public address
- txid
- read query parameters
- signed raw transaction

Not allowed:

- mnemonic
- seed phrase
- private key
- unsigned signing material that enables fund control
- persistent address/IP identity tracking beyond operational logs

## Build and deploy flow

```bash
npm install
npm run build
```

Deploy `apps/web/dist` to `/var/www/pepew-light/wallet/` and serve it under `/wallet/`. Nginx should provide SPA fallback for wallet routes while keeping `/api/*` proxied to FastAPI.

## Current phase checklist

- `/wallet/` opens quickly.
- Logo and static assets load from the correct `/wallet/` base path.
- Wallet can import mnemonic locally.
- Wallet shows non-custodial warning before or during import.
- Wallet can show balance and history from PEPEW Light API.
- Receive address and QR display correctly.
- Send can submit signed raw tx only.
- API errors are user-facing and do not expose internals.
