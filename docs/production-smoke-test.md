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
- Send page opens in preview mode only.
- Send page does not sign or broadcast transactions.
- History page loads.
- Transaction detail loads only after pressing `Details` on a history row.
- API errors display as clean user-facing messages.

## Browser DevTools Network checks

Allowed wallet read-only API endpoints:

```text
GET /api/wallet/address/{address}
GET /api/wallet/history/{address}
GET /api/wallet/tx/{txid}
```

The wallet deployment must not call transaction broadcast endpoints during Phase 4.5 Send Preview.

## Forbidden in Network / Console / logs

The following must not appear in Network payloads, URL query strings, Console output, Nginx logs, or application logs:

```text
mnemonic
seed phrase
seedPhrase
private key
privateKey
xprv
full wallet object
signed raw transaction
raw transaction
```

Expected safe appearances:

- UI safety warning text.
- Documentation text.
- Client-side local-only wallet code that does not send secrets to the server.

Unsafe appearances that must be patched immediately:

- API request body or query parameter containing mnemonic, seed phrase, private key, xprv, signed raw transaction, raw transaction, or full wallet object.
- Console log containing wallet secrets.
- Server log containing wallet secrets.

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
8. Confirm the page says `Send is in preview mode` and `Broadcast is not enabled yet`.
9. Enter recipient, amount, and fee. Confirm only the review preview changes.
10. Confirm the send button is disabled and reads `Broadcast disabled`.
11. Confirm Network does not call broadcast, raw transaction, Telegram, paylink, or legacy wallet APIs.
12. If unconfirmed balance exists and is greater than zero, confirm it appears as:

```text
Unconfirmed: <amount> PEPEW
```

13. Open the history page and confirm history loads.
14. Press `Details` on one transaction row and confirm a transaction detail card appears.
15. Confirm the detail request is only:

```text
GET /api/wallet/tx/{txid}
```

16. Enter an invalid PEPEW address and confirm the error is user-facing, not a raw internal code.
17. In DevTools Network and Console, search for the forbidden terms above.

## Post-deploy browser checklist

Use DevTools after a production build has been deployed:

- Network tab: clear entries, then reload `/wallet/`.
- Import mnemonic.
- Confirm balance and history.
- Open `/wallet/send` and confirm only `/api/wallet/address/{address}` is used for balance lookup.
- Confirm `/wallet/send` does not call `/wallet/tx/broadcast`, `/wallet/tx/raw`, `/wallet/utxos`, `/v1/*`, `/auth/telegram`, or `/api/paylink`.
- Press `Details` on one history item and confirm `/api/wallet/tx/{txid}` is called once.
- Press `Details` on the same history item again and confirm cached display works without repeated unnecessary calls.
- Filter Network requests for `mnemonic`, `seed`, `private`, `xprv`, `raw`.
- Confirm Light API calls only include addresses or txids.
- Confirm Console does not print request bodies, wallet objects, mnemonic, private key, raw transaction, or xprv.
- With `?debug=1`, Console may show API path, method, `has_body`, and token key hint only. It must not print request body content.

## Server log scan commands

```bash
sudo tail -n 500 /var/log/nginx/pepepow-wallet-access.log 2>/dev/null | grep -Ei "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|raw transaction" || true
journalctl -u pepew-light -n 500 --no-pager 2>/dev/null | grep -Ei "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|raw transaction" || true
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

## Public URL verification

```bash
curl -I https://light.pepepow.net/wallet/
curl -I https://light.pepepow.net/wallet/send
curl -I https://light.pepepow.net/wallet/brand/logo.png
curl -i "https://light.pepepow.net/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb"
curl -i "https://light.pepepow.net/api/wallet/history/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb"
```

For a known transaction from the history response:

```bash
curl -i "https://light.pepepow.net/api/wallet/tx/<txid>"
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
grep -RIn -E "mnemonic|seed phrase|seedPhrase|private key|privateKey|xprv|raw transaction" apps/web/dist apps/web/src docs \
  --exclude-dir=node_modules \
  --exclude-dir=.git || true
```

Classify hits:

- Safe: UI warning text, documentation, local-only code.
- Unsafe: API payload, URL query, console log, server-bound object.

Patch unsafe hits immediately.
