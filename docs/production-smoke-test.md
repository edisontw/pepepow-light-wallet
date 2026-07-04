# PEPEW Light Wallet Production Smoke Test

Public wallet URL:

```text
https://light.pepepow.net/wallet/
```

## Expected checks

- `/wallet/` page loads successfully.
- Logo displays correctly.
- Create wallet works.
- Import mnemonic works.
- Address displays after wallet creation or mnemonic import.
- Confirmed balance displays in the wallet home page.
- Send page builds, signs, and broadcasts from the browser.
- Send page submits only signed raw tx to `/api/wallet/broadcast`.
- Consecutive small sends work with automatic UTXO/indexer retry.
- History page loads.
- History rows show deterministic `Status` and `Height`.
- API errors display as clean user-facing messages.

## Browser DevTools Network checks

Allowed wallet API endpoints:

```text
GET /api/wallet/address/{address}
GET /api/wallet/history/{address}
GET /api/wallet/utxo/{address}
GET /api/wallet/tx/{txid}
GET /api/wallet/tx/{txid}?raw=1
POST /api/wallet/broadcast
```

Broadcast rule:

```text
POST /api/wallet/broadcast may only contain signed raw transaction hex.
It must never contain mnemonic, seed phrase, private key, WIF, xprv, or a wallet object.
```

## Manual browser verification

1. Open `https://light.pepepow.net/wallet/`.
2. Confirm the non-custodial safety notice appears.
3. Confirm the logo appears.
4. Create a wallet or import a known test mnemonic.
5. Confirm the derived address appears.
6. Confirm balance and history load from PEPEW Light API.
7. Open `/wallet/send`.
8. Enter recipient, amount, and fee.
9. Press `Send PEPEW` with a small test amount.
10. Confirm Network calls include UTXO lookup, previous raw tx lookup, and signed raw tx broadcast only.
11. Confirm the broadcast request contains only `{ "raw_tx": "<signed raw transaction hex>" }`.
12. Confirm the broadcast response shows a txid or a clean user-facing error.
13. Repeat 2-3 small sends and confirm automatic retry handles short API/indexer delay.
14. Open history and confirm the transactions appear after refresh/indexer update.

## Forbidden in Network / Console / logs

The following must not appear in Network payloads, URL query strings, Console output, Nginx logs, or application logs:

```text
mnemonic
seed phrase
seedPhrase
private key
privateKey
xprv
WIF
full wallet object
```

Expected safe appearances:

- UI safety warning text.
- Documentation text.
- Client-side local-only wallet code that does not send secrets to the server.
- Signed raw transaction hex only inside `POST /api/wallet/broadcast` request body.

Unsafe appearances that must be patched immediately:

- API request body or query parameter containing wallet recovery material.
- Console log containing wallet secrets or signed raw transaction.
- Server log containing wallet secrets or signed raw transaction.

## Build and deploy commands

```bash
cd /home/ubuntu/pepepow-light-wallet
git status --short
export PATH="/home/ubuntu/node-dist/bin:$PATH"
npm --prefix apps/web run test:client
npm run build
npm --prefix apps/web run scan:readonly-api
sudo mkdir -p /var/www/pepew-light/wallet
sudo rsync -a --delete apps/web/dist/ /var/www/pepew-light/wallet/
sudo nginx -t
sudo systemctl reload nginx
```

Backend deploy commands are in `pepepow-electrumx-service`; deploy backend before testing Send broadcast if the broadcast API changed.

## Public URL verification

```bash
curl -I https://light.pepepow.net/wallet/
curl -I https://light.pepepow.net/wallet/send
curl -i "https://light.pepepow.net/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb"
curl -i "https://light.pepepow.net/api/wallet/history/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb"
curl -i "https://light.pepepow.net/api/wallet/utxo/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb"
```

For a known transaction from the history response:

```bash
curl -i "https://light.pepepow.net/api/wallet/tx/<txid>"
curl -i "https://light.pepepow.net/api/wallet/tx/<txid>?raw=1"
```

Broadcast validation smoke test with invalid raw tx must return a clean 400 error:

```bash
curl -i -X POST "https://light.pepepow.net/api/wallet/broadcast" \
  -H "Content-Type: application/json" \
  -d '{"raw_tx":"not_hex"}'
```

## Legacy API scan

Preferred scan after `npm run build`:

```bash
npm --prefix apps/web run scan:readonly-api
```

Fallback scan for built runtime only:

```bash
grep -RIn "api.pepepow.net" apps/web/dist || true
grep -RIn "/v1/\|/wallet/utxos\|/wallet/price\|/wallet/tx/broadcast\|/wallet/tx/raw" apps/web/dist || true
```

Expected public wallet runtime should not call legacy wallet APIs.

## Local secret scan

```bash
grep -RIn -E "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|WIF" apps/web/dist apps/web/src docs \
  --exclude-dir=node_modules \
  --exclude-dir=.git || true
```

Classify hits:

- Safe: UI warning text, documentation, local-only code.
- Unsafe: API payload, URL query, console log, server-bound object.

Patch unsafe hits immediately.
