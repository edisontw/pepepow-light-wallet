# PEPEW Light API Integration

The web wallet integrates with PEPEW Light API from `pepepow-electrumx-service`.

This replaces the old `pepew-api` / `wallet-api` split from `pepepow-wallet-suite`. Current wallet reads should use `https://light.pepepow.net/api/wallet/*` or same-origin `/api/wallet/*` when served from `https://light.pepepow.net/wallet/`.

## Base URL

Production default:

```text
same-origin
```

Optional development override:

```bash
VITE_PEPEW_LIGHT_API_BASE_URL=https://light.pepepow.net
```

The frontend client normalizes this value and defaults to same-origin when unset.

## Wallet endpoints

### Address summary

```http
GET /api/wallet/address/{address}
```

Purpose:

- validate address
- return confirmed/unconfirmed balance
- return a compact recent history list

Expected fields include:

```json
{
  "address": "P...",
  "balance": {
    "confirmed": 0,
    "unconfirmed": 0,
    "confirmed_pepew": "0",
    "unconfirmed_pepew": "0"
  },
  "history": [],
  "source": "electrumx",
  "read_only": true
}
```

### Address history

```http
GET /api/wallet/history/{address}?limit=50&offset=0
```

Purpose:

- return confirmed history
- return mempool entries when available

### UTXO lookup

```http
GET /api/wallet/utxo/{address}
```

Purpose:

- return spendable outputs for future send flow
- keep UTXO selection in client-side wallet logic

### Transaction lookup

```http
GET /api/wallet/tx/{txid}
GET /api/wallet/tx/{txid}?raw=1
```

Purpose:

- inspect transaction details
- optionally fetch raw transaction data

### Broadcast

```http
POST /api/wallet/broadcast
Content-Type: application/json

{
  "raw_tx": "<SIGNED_RAW_TX>"
}
```

Rules:

- this endpoint may only receive signed raw transactions
- the backend must not sign transactions
- the frontend must display transaction details before signing and broadcast

## Cache behavior

The frontend can request fresh reads by appending:

```text
fresh=1
```

The API gateway owns actual cache TTLs. Typical production TTLs:

- status: 5-10 seconds
- balance: 10-20 seconds
- history: 20-60 seconds
- tx: 5-10 minutes

## Error handling

Frontend should map backend errors to friendly messages:

| Condition | User-facing behavior |
| --- | --- |
| invalid address | ask user to check PEPEW address format |
| timeout | ask user to retry |
| rate limit | ask user to wait briefly |
| ElectrumX unavailable | show API temporarily unavailable |
| broadcast rejected | explain transaction may use stale UTXOs or be invalid |

Backend error messages must not expose internal paths, credentials, process state, or raw upstream exception details.

## Security contract

Allowed request data:

- address
- txid
- pagination/fresh query options
- signed raw transaction

Disallowed request data:

- recovery phrase
- private signing material
- server-side wallet import payloads
- persistent user identity binding for this public web wallet

## Smoke tests

```bash
curl -s https://light.pepepow.net/api/health
curl -s https://light.pepepow.net/api/status
curl -s https://light.pepepow.net/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
curl -s "https://light.pepepow.net/api/wallet/history/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?limit=5&offset=0"
curl -s https://light.pepepow.net/api/wallet/utxo/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
```
