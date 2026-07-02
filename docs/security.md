# PEPEW Light Wallet Security

PEPEW Light Wallet is non-custodial. The user controls wallet recovery material and signing happens on the client side.

## Non-custodial rules

1. Wallet recovery material stays on the user's device.
2. Private signing material is never sent to PEPEW Light API, ElectrumX, PEPEPOWd, logs, analytics, or third-party services.
3. The backend never derives addresses, signs transactions, or reconstructs wallets.
4. Broadcast accepts only a fully signed raw transaction.
5. The wallet must clearly warn users before import that whoever has the recovery phrase can control funds.

## Threat model

### Phishing

Risk: fake wallet pages can ask users to import their wallet and steal funds.

Controls:

- Display official-domain warnings.
- Keep user-facing warnings in English and Chinese.
- Avoid instructions that normalize entering recovery phrases into random websites.
- Keep release/deployment paths predictable, preferably `https://light.pepepow.net/wallet/`.

### Client-side script compromise

Risk: injected JavaScript can read user input or alter transaction outputs.

Controls:

- Keep dependencies minimal.
- Prefer static files served with strict cache and security headers.
- Avoid third-party scripts in the wallet page.
- Review any package that touches mnemonic import, derivation, signing, or transaction construction.

### Backend compromise

Risk: the API can show wrong balances/history, reject requests, or broadcast a submitted signed transaction incorrectly.

Expected fund impact is limited because the backend does not hold private signing material.

Controls:

- Treat API data as display data, not custody.
- Show transaction details clearly before signing and broadcasting.
- Keep ElectrumX private behind Nginx and FastAPI.
- Use validation, timeout, rate limit, and safe error messages on the API gateway.

### Privacy leakage

Risk: repeated address lookups can associate IP addresses and public addresses.

Controls:

- Do not add long-term address/IP tracking.
- Avoid unnecessary analytics.
- Keep logs short-lived and operational.
- Do not store wallet import events or recovery material.

## Developer checklist

Before merging wallet changes:

- Search for network calls in mnemonic/import/signing paths.
- Confirm no recovery material is logged.
- Confirm no server route accepts recovery material.
- Confirm `/api/wallet/*` receives only public addresses, txids, read parameters, or signed raw tx.
- Run the read-only API scan when changing frontend service code.
- Check invalid address, API timeout, and API unavailable messages.

## User-facing warning text

Recommended English:

> PEPEW Light Wallet is non-custodial. Your recovery phrase and private keys stay on this device. The server cannot recover your wallet. Never enter your recovery phrase on an untrusted website.

Recommended Traditional Chinese:

> PEPEW Light Wallet 是非託管錢包。助記詞與私鑰只應保留在你的裝置上，伺服器無法恢復你的錢包。請勿在不可信的網站輸入助記詞。
