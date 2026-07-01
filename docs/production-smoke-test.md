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
- Send page builds and signs transactions in the browser only.
- Send page broadcasts only after explicit final confirmation.
- History page loads.
- Transaction detail loads only after pressing `Details` on a history row.
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

- API request body or query parameter containing mnemonic, seed phrase, private key, WIF, xprv, or full wallet object.
- Console log containing wallet secrets or signed raw transaction.
- Server log containing wallet secrets or signed raw transaction.

## Manual browser verification

1. Open `https://light.pepepow.net/wallet/`.
2. Confirm the non-custodial safety notice appears once and in English only.
3. Confirm the logo appears.
4. Create a wallet or import a known test mnemonic.
5. Confirm the derived address appears.
6. Confirm the confirmed balance appears as:

```text
Confirmed Balance
<amount> PEPEW
Source: PEPEW Light API / ElectrumX Gateway
```

7. Open `/wallet/send`.
8. Confirm the page says `Client-side signing`.
9. Enter recipient, amount, and fee.
10. Press `Build signed transaction`.
11. Confirm Network calls:

```text
GET /api/wallet/utxo/{address}
GET /api/wallet/tx/{txid}?raw=1
```

12. Confirm the signed transaction preview appears with inputs, size, total input, change, and raw hex preview.
13. Confirm `Broadcast signed transaction` stays disabled until the final confirmation checkbox is checked.
14. Check the confirmation box and press `Broadcast signed transaction`.
15. Confirm the only broadcast request is:

```text
POST /api/wallet/broadcast
```

16. Confirm the broadcast request contains only:

```json
{"raw_tx":"<signed raw transaction hex>"}
```

17. Confirm the broadcast response shows a txid or a clean user-facing error.
18. Confirm no legacy wallet APIs are called.
19. Open the history page and confirm history loads.
20. Press `Details` on one transaction row and confirm a transaction detail card appears.
21. Confirm the detail request is only:

```text
GET /api/wallet/tx/{txid}
```

22. In DevTools Network and Console, search for the forbidden terms above.

## Post-deploy browser checklist

Use DevTools after a production build has been deployed:

- Network tab: clear entries, then reload `/wallet/`.
- Import mnemonic.
- Confirm balance and history.
- Open `/wallet/send`.
- Build a signed transaction with a small test amount.
- Confirm signing happens without sending mnemonic/private key/WIF/xprv to the server.
- Confirm previous transaction lookups use `/api/wallet/tx/{txid}?raw=1`.
- Confirm `/api/wallet/broadcast` is called only after final checkbox confirmation.
- Confirm `/wallet/send` does not call `/wallet/tx/broadcast`, `/wallet/tx/raw`, `/wallet/utxos`, `/v1/*`, `/auth/telegram`, or `/api/paylink`.
- Press `Details` on one history item and confirm `/api/wallet/tx/{txid}` is called once.
- Filter Network requests for `mnemonic`, `seed`, `private`, `xprv`, `wif`.
- Confirm Light API calls include only addresses, txids, UTXO lookup, tx lookup, or signed raw tx broadcast.
- Confirm Console does not print request bodies, wallet objects, mnemonic, private key, WIF, raw transaction, or xprv.

## Server log scan commands

```bash
sudo tail -n 500 /var/log/nginx/pepepow-wallet-access.log 2>/dev/null | grep -Ei "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|wif|raw_tx|raw transaction" || true
journalctl -u pepew-light -n 500 --no-pager 2>/dev/null | grep -Ei "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|wif|raw_tx|raw transaction" || true
```

## Build and deploy commands

```bash
cd /home/ubuntu/pepepow-light-wallet
git status --short
export PATH="/home/ubuntu/node-dist/bin:$PATH"
npm --prefix apps/web run test:client
npm run build
npm --prefix apps/web run scan:readonly-api
sudo rsync -a --delete apps/web/dist/ /var/www/pepepow-light-wallet/
```

Backend deploy commands are in `pepepow-electrumx-service`; deploy backend before testing Send broadcast.

## Public URL verification

```bash
curl -I https://light.pepepow.net/wallet/
curl -I https://light.pepepow.net/wallet/send
curl -I https://light.pepepow.net/wallet/brand/logo.png
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
