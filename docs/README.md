# PEPEW Light Wallet Documentation

This directory contains the active documentation for the PEPEW Light Wallet public beta.

## Current scope

PEPEW Light Wallet is a client-side, non-custodial PEPEPOW web wallet served at:

```text
https://light.pepepow.net/wallet/
```

The wallet uses PEPEW Light API for blockchain data and signed raw transaction broadcast. Mnemonic, private keys, derivation, and signing remain in the browser.

## Active docs

| File | Purpose |
| --- | --- |
| `architecture.md` | Current wallet architecture and repository boundaries |
| `security.md` | Non-custodial rules, threat model, and developer checklist |
| `pepew-api.md` | PEPEW Light API integration contract for wallet/app developers |
| `broadcast-plan.md` | Current signed raw tx broadcast contract |
| `send-beta-test-notes.md` | Send beta status, consecutive-send behavior, and known limitations |
| `deploy-light-pepepow-net.md` | Production deployment commands for `light.pepepow.net/wallet/` |
| `deploy_layout.md` | Host path and Nginx static routing layout |
| `production-smoke-test.md` | Manual browser, API, and Network-tab verification checklist |
| `DEV_COMPASS.md` | Short working guide for future development agents |

## Removed scope

Old wallet-suite documents for messaging integrations, trading bots, exchange automation, old wallet API services, and separate wallet domains are intentionally not part of this repository's active documentation.

## Before deployment

Run:

```bash
npm run build
npm --prefix apps/web run scan:readonly-api
```

Deploy static files to:

```text
/var/www/pepew-light/wallet/
```

## Core safety rule

The backend must receive only public addresses, txids, query options, or signed raw transaction hex. It must never receive wallet recovery material or signing secrets.
