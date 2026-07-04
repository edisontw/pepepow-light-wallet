# PEPEW Light API Integration

PEPEW Light Wallet integrates with the PEPEW Light API served by `pepepow-electrumx-service`.

This document is the public API contract for wallet and application developers. It intentionally covers only the current PEPEW Light / ElectrumX gateway flow. Legacy `pepepow-wallet-suite` service documents, trading bots, Telegram control-plane APIs, and standalone wallet-server concepts are out of scope for this repository.

## Base URL

Production:

```text
https://light.pepepow.net
```

Same-origin production use from the hosted wallet:

```text
/api/wallet/*
```

Local development override:

```bash
VITE_PEPEW_LIGHT_API_BASE_URL=https://light.pepepow.net
```

When the wallet is served from `https://light.pepepow.net/wallet/`, keep API calls same-origin unless a staging API has been explicitly reviewed.

## API scope

Allowed request data:

- PEPEPOW address
- transaction id
- pagination options
- payment-check amount and expiry options
- signed raw transaction hex for broadcast

Not allowed:

- mnemonic / recovery phrase
- private key
- unsigned signing material that gives fund control
- server-side wallet import payload
- long-term address/IP identity binding for the public wallet

The API gateway reads data from ElectrumX and may broadcast a signed raw transaction. It must not derive keys or sign transactions.

## CORS support

Current PEPEW Light API is configured for browser access:

```text
Access-Control-Allow-Origin: *
Methods: GET, POST, OPTIONS
Headers: Content-Type, Cache-Control
Credentials: false
```

Recommended production integration is still same-origin through `https://light.pepepow.net/wallet/` -> `/api/*`. Third-party applications may call the public API directly, but should handle rate limits and temporary API unavailability.

## Validation rules

### Address

Server-side validation is authoritative. Client-side checks should be treated only as a fast preflight.

Current PEPEW address rules:

- type: Base58Check P2PKH address
- prefix: `P`
- version byte: `0x37`
- payload: 20-byte hash160
- checksum: valid Base58Check checksum
- invalid Base58 characters are rejected
- empty or whitespace-only values are rejected

Example valid-looking format:

```text
PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
```

Do not accept an address only because it starts with `P`; it must pass Base58Check, version, and payload-length validation.

### Transaction id

Rules:

- exactly 64 characters
- lowercase or uppercase hex accepted
- normalized to lowercase internally

Regex preflight:

```regex
^[0-9a-fA-F]{64}$
```

### Signed raw transaction

Rules:

- JSON field name: `raw_tx`
- hex string only
- optional `0x` prefix may be stripped by the backend
- even number of hex characters
- minimum length: 20 hex characters
- maximum length: 200,000 hex characters
- must already be signed by the client wallet

Regex preflight after removing optional `0x`:

```regex
^[0-9a-fA-F]+$
```

## Wallet endpoints

### Address summary

```http
GET /api/wallet/address/{address}
GET /api/wallet/address/{address}?fresh=1
```

Purpose:

- validate address
- return confirmed/unconfirmed balance
- return compact recent history
- expose read-only ElectrumX-backed wallet state

Response example:

```json
{
  "address": "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
  "balance": {
    "confirmed": 1664826476764372,
    "unconfirmed": 0,
    "confirmed_pepew": "16648264.76764372",
    "unconfirmed_pepew": "0"
  },
  "history": [
    {
      "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "height": 4620000
    }
  ],
  "source": "electrumx",
  "read_only": true,
  "cache": {
    "hit": true,
    "ttl": 20
  }
}
```

Notes:

- balance integer fields are atomic units, using 8 decimals.
- `confirmed_pepew` and `unconfirmed_pepew` are display strings.
- `fresh=1` asks the API to bypass cache where supported. Use sparingly.

### Address history

```http
GET /api/wallet/history/{address}?limit=50&offset=0
GET /api/wallet/history/{address}?limit=50&offset=0&fresh=1
```

Query parameters:

| Parameter | Type | Default | Rule |
| --- | --- | ---: | --- |
| `limit` | integer | `50` | `1` to `500` |
| `offset` | integer | `0` | `>= 0` |
| `fresh` | boolean | `false` | optional cache bypass |

Response example:

```json
{
  "address": "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
  "history": [
    {
      "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "height": 4620000
    }
  ],
  "mempool": [
    {
      "txid": "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      "height": 0
    }
  ],
  "source": "electrumx",
  "read_only": true,
  "cache": {
    "hit": false
  }
}
```

### UTXO lookup

```http
GET /api/wallet/utxo/{address}
GET /api/wallet/utxo/{address}?fresh=1
```

Purpose:

- return spendable outputs for client-side coin selection
- keep UTXO selection, fee calculation, transaction construction, and signing inside the wallet client

Response example:

```json
{
  "address": "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
  "utxos": [
    {
      "tx_hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "tx_pos": 0,
      "height": 4620000,
      "value": 100000000
    }
  ],
  "utxo_count": 1,
  "total": 100000000,
  "source": "electrumx",
  "read_only": true,
  "cache": {
    "hit": true
  }
}
```

### Transaction lookup

```http
GET /api/wallet/tx/{txid}
GET /api/wallet/tx/{txid}?raw=1
```

Purpose:

- inspect transaction details
- fetch raw transaction data when needed by wallet logic

Verbose response example:

```json
{
  "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "data": {
    "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "version": 1,
    "vin": [],
    "vout": [],
    "confirmations": 3
  },
  "source": "electrumx",
  "read_only": true,
  "raw": false
}
```

Raw response example:

```json
{
  "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "data": {
    "hex": "01000000...",
    "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "source": "electrumx",
  "read_only": true,
  "raw": true
}
```

### Broadcast

```http
POST /api/wallet/broadcast
Content-Type: application/json

{
  "raw_tx": "<SIGNED_RAW_TX_HEX>"
}
```

Successful response example:

```json
{
  "ok": true,
  "txid": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "source": "electrumx",
  "signed_raw_tx_only": true
}
```

Rules:

- this endpoint may only receive signed raw transaction hex
- backend must not sign transactions
- backend must not receive mnemonic or private keys
- frontend must show recipient, amount, fee, change, and final tx summary before signing and broadcast
- failed broadcast may mean stale UTXO, insufficient fee, invalid signature, already-spent input, mempool rejection, or temporary upstream failure

## Payment check endpoint

```http
GET /api/payment/check?address={address}&amount={amount}
GET /api/payment/check?address={address}&amount={amount}&confirmations=1&expires_in=900
GET /api/payment/check?address={address}&amount={amount}&confirmations=1&expires_at=2026-07-04T12:00:00Z
```

Query parameters:

| Parameter | Type | Required | Rule |
| --- | --- | --- | --- |
| `address` | string | yes | valid PEPEW address |
| `amount` | string | yes | positive PEPEW amount, up to 8 decimals |
| `confirmations` | integer | no | `>= 0`; defaults to backend setting |
| `expires_in` | integer | no | positive seconds from now |
| `expires_at` | ISO8601 string | no | absolute expiry timestamp |

Example request:

```bash
curl -s "https://light.pepepow.net/api/payment/check?address=PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb&amount=12.5&confirmations=1&expires_in=900"
```

Response example:

```json
{
  "ok": true,
  "address": "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
  "requested_amount": "12.5",
  "requested_sats": 1250000000,
  "amount": "12.5",
  "amount_sats": 1250000000,
  "amount_pepew": "12.5",
  "pepew_decimals": 8,
  "confirmed_balance": "10",
  "confirmed_balance_sats": 1000000000,
  "mempool_balance": "2.5",
  "mempool_balance_sats": 250000000,
  "total_visible_balance": "12.5",
  "total_visible_balance_sats": 1250000000,
  "confirmations_required": 1,
  "status": "paid_unconfirmed",
  "expired": false,
  "status_explanation": "Current visible balance meets the requested amount, but confirmations are insufficient.",
  "history_count": 4,
  "mempool_count": 1,
  "checked_at": 1783137600,
  "response_time_ms": 42.1,
  "expires_in": 860
}
```

Payment statuses:

| Status | Meaning |
| --- | --- |
| `waiting` | no visible payment yet |
| `seen_in_mempool` | mempool activity exists, but visible balance is below requested amount |
| `partial` | received amount is greater than zero but below requested amount |
| `paid_unconfirmed` | total visible balance meets amount, but confirmation requirement is not met |
| `paid_confirmed` | confirmed balance meets amount and confirmation requirement |
| `overpaid` | visible or confirmed balance is greater than requested amount |
| `expired` | payment monitor expiry passed |
| `error` | payment status could not be checked |

## Wallet UTXO + broadcast flow

Recommended non-custodial send flow:

1. Client derives the sender address locally from mnemonic/private key.
2. Client calls `GET /api/wallet/utxo/{address}?fresh=1`.
3. Client selects UTXOs locally.
4. Client estimates the transaction size and fee locally.
5. Client constructs unsigned transaction locally.
6. Client displays recipient, amount, fee, selected inputs, and change output to the user.
7. Client signs locally.
8. Client serializes signed raw transaction hex.
9. Client calls `POST /api/wallet/broadcast` with only `{ "raw_tx": "..." }`.
10. Client displays returned txid and refreshes history after a short delay.

Important implementation notes:

- Never send mnemonic, private key, seed, xprv, or unsigned signing material to the API.
- Refresh UTXOs before signing to reduce stale-input failures.
- Re-check the change address belongs to the local wallet before signing.
- Treat broadcast errors as non-final until the tx is looked up by txid or the wallet refreshes UTXOs/history.
- Keep broadcast disabled in UI until the transaction review and signing flow is complete.

## Error response format

All expected API errors should use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_address",
    "message": "Invalid PEPEPOW address."
  }
}
```

Error codes:

| HTTP | Code | Meaning | Client behavior |
| ---: | --- | --- | --- |
| 400 | `empty_address` | address is empty | ask user to enter an address |
| 400 | `invalid_address` | malformed address or invalid Base58 payload | ask user to check address |
| 400 | `invalid_address_checksum` | Base58Check checksum failed | ask user to check copied address |
| 400 | `unsupported_address_prefix` | address prefix/version unsupported | explain only PEPEW P2PKH is supported |
| 400 | `invalid_txid` | txid is not 64 hex characters | ask user to check txid |
| 400 | `invalid_amount` | payment amount is invalid | ask user to enter positive PEPEW amount |
| 400 | `invalid_confirmations` | confirmations value is negative | ask user to use zero or greater |
| 400 | `invalid_expiry` | expiry is not valid ISO8601 or positive seconds | ask user to fix expiry |
| 400 | `invalid_raw_tx` | signed raw tx is not valid hex | block broadcast and show error |
| 400 | `raw_tx_too_short` | raw tx is too short | block broadcast |
| 400 | `raw_tx_too_large` | raw tx exceeds maximum size | block broadcast |
| 404 | `tx_not_found` | transaction not found | show not found; allow retry |
| 429 | `rate_limited` | too many requests | back off and retry later |
| 503 | `electrumx_error` | ElectrumX or daemon temporarily unavailable | show API temporarily unavailable |
| 503 | `broadcast_rejected` | upstream rejected signed tx | show broadcast failed; refresh UTXOs |
| 500 | `internal_error` | safe generic server error | show generic retry message |

Backend errors must not expose internal file paths, environment values, process state, credentials, hostnames, or raw upstream exception details.

## Rate limits and cache behavior

The public API is protected by Nginx/API rate limiting. Exact production limits may change without a breaking API version bump.

Expected client behavior:

- handle HTTP `429` as rate-limited
- pause polling after a `429`
- use exponential backoff for repeated failures
- avoid rapid repeated `fresh=1` calls
- avoid polling the same address more frequently than every few seconds
- cache successful address/history responses in the UI for short intervals

Typical production cache TTLs:

| Resource | Typical TTL |
| --- | ---: |
| status | 5-10 seconds |
| balance/address summary | 10-20 seconds |
| history | 20-60 seconds |
| tx lookup | 5-10 minutes |

Suggested polling intervals:

| Use case | Suggested interval |
| --- | ---: |
| wallet balance display | 15-30 seconds |
| payment monitor waiting state | 10-20 seconds |
| confirmed payment waiting | 20-60 seconds |
| tx detail page | manual refresh or 30+ seconds |

## Smoke tests

```bash
curl -s https://light.pepepow.net/api/health
curl -s https://light.pepepow.net/api/status
curl -s https://light.pepepow.net/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
curl -s "https://light.pepepow.net/api/wallet/history/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb?limit=5&offset=0"
curl -s https://light.pepepow.net/api/wallet/utxo/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
curl -s "https://light.pepepow.net/api/payment/check?address=PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb&amount=1&confirmations=1&expires_in=900"
```

Broadcast smoke test must not use a fake transaction on production. Use only a real signed transaction created by the client wallet, and only after send-flow review is complete.

## Production use disclaimer

PEPEW Light API and PEPEW Light Wallet are public beta infrastructure for PEPEPOW.

- The wallet is non-custodial; users are responsible for their recovery phrase and private keys.
- The API cannot recover wallets, reverse transactions, or access private keys.
- Public endpoints may be rate-limited, cached, restarted, or temporarily unavailable.
- API responses are intended for wallet display and application integration, not as a sole accounting or exchange-grade settlement source.
- Applications that accept payments should independently define confirmation requirements, expiry behavior, overpayment handling, and retry logic.
- Broadcast support accepts only signed raw transactions and may remain disabled in the UI until the transaction flow is fully reviewed.
