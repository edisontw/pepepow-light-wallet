# PEPEW Light Wallet Broadcast Contract

This document defines the current signed raw transaction broadcast flow for the PEPEW Light web wallet.

## Security boundary

- Mnemonic and private keys stay in the browser only.
- Transaction signing happens client-side only.
- The backend accepts only addresses, txids, read queries, and signed raw transactions.
- The backend never accepts mnemonic phrases, private keys, WIF keys, derivation seeds, or unsigned transaction signing requests.
- ElectrumX remains behind the PEPEW Light API gateway and is not directly exposed to public clients.

## Endpoint

```http
POST /api/wallet/broadcast
Content-Type: application/json
```

Request body:

```json
{
  "raw_tx": "01000000..."
}
```

Success response:

```json
{
  "ok": true,
  "txid": "<broadcast transaction id>",
  "source": "electrumx",
  "signed_raw_tx_only": true
}
```

Error response:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_raw_tx",
    "message": "Signed raw transaction must be hex."
  }
}
```

## Backend validation checklist

Before forwarding any transaction to the node or broadcast backend, validate:

- `raw_tx` exists and is a string.
- request body contains only `raw_tx`.
- request body rejects extra fields and signing material fields.
- `raw_tx` is hex only: `^[0-9a-fA-F]+$`.
- `raw_tx` length is even.
- `raw_tx` byte size is under the configured maximum.
- Request body size is limited at the reverse proxy and application layer.
- API response does not expose internal node, ElectrumX, filesystem, or stack trace details.
- Rate limiting is enabled.
- Logging avoids address/IP linkage beyond short operational needs.

## Client-side signing flow

Wallet flow:

1. User creates or imports mnemonic in the browser.
2. Client derives the PEPEW address locally.
3. Client fetches balance, UTXOs, and previous transaction data from PEPEW Light API.
4. Client builds and signs the transaction locally.
5. Client sends only the signed raw transaction to `/api/wallet/broadcast`.
6. Backend broadcasts the signed transaction and returns txid/status.
7. Client records recently spent outpoints to avoid selecting stale API outputs.
8. Client retries briefly while the API/indexer catches up after consecutive sends.

## UI summary checklist

Before or during send, the UI should show:

- Sender address.
- Recipient address.
- Recipient amount.
- Network fee.
- Change amount.
- Number of inputs.
- Warning that blockchain transactions cannot be reversed.

## Error handling

Use user-safe messages:

- `Invalid signed transaction payload.`
- `Broadcast failed. Please verify the transaction and try again.`
- `PEPEW Light API is temporarily unavailable.`
- `Transaction rejected by the network.`
- `Waiting for wallet UTXOs to update...`

Do not expose:

- Internal exception class names.
- ElectrumX host/port.
- Node RPC URL.
- Backend filesystem paths.
- Stack traces.

## Test checklist

Backend tests:

- Reject missing `raw_tx`.
- Reject non-string `raw_tx`.
- Reject non-hex payload.
- Reject odd-length hex.
- Reject oversized payload.
- Reject extra payload fields.
- Reject mnemonic/private-key/WIF/seed fields.
- Return safe error shape.
- Apply rate limits.

Client tests:

- Mnemonic/private key is never sent to API.
- Broadcast request contains only signed raw transaction payload.
- Failed broadcast shows a safe user-facing error.
- Consecutive sends recover after short API/indexer delay.
- Mobile layout remains readable.

## Implementation rule

Do not add mnemonic, private key, WIF, seed derivation, or signing logic to `pepepow-electrumx-service`. Those functions belong only in the client-side wallet code.
