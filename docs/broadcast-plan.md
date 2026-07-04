# PEPEW Light Wallet Broadcast Plan

This document defines the planned signed raw transaction broadcast flow for the PEPEW Light web wallet.

The current public beta must remain non-custodial. The backend must never receive, store, derive, log, or inspect wallet mnemonics or private keys.

## 1. Security boundary

- Mnemonic and private keys stay in the browser only.
- Transaction signing happens client-side only.
- The backend accepts only addresses, txids, read-only queries, and future signed raw transactions.
- The backend never accepts mnemonic phrases, private keys, WIF keys, derivation seeds, or unsigned transaction signing requests.
- ElectrumX remains behind the PEPEW Light API gateway and is not directly exposed to public clients.

## 2. Future endpoint

Planned endpoint:

```http
POST /api/wallet/broadcast
Content-Type: application/json
```

Draft request body:

```json
{
  "raw_tx": "01000000..."
}
```

Draft success response:

```json
{
  "ok": true,
  "txid": "<broadcast transaction id>",
  "status": "broadcasted"
}
```

Draft error response:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_raw_tx",
    "message": "Invalid signed transaction payload."
  }
}
```

## 3. Backend validation checklist

Before forwarding any transaction to the node or broadcast backend, validate:

- `raw_tx` exists and is a string.
- `raw_tx` is hex only: `^[0-9a-fA-F]+$`.
- `raw_tx` length is even.
- `raw_tx` byte size is under the configured maximum.
- Request body size is limited at the reverse proxy and application layer.
- API response does not expose internal node, ElectrumX, filesystem, or stack trace details.
- Rate limiting is enabled.
- Logging avoids address-IP linkage beyond short operational needs.

## 4. Client-side signing flow

Planned wallet flow:

1. User creates or imports mnemonic in the browser.
2. Client derives the PEPEW address locally.
3. Client fetches balance, UTXOs, and previous transaction data from PEPEW Light API.
4. Client builds and signs the transaction locally.
5. Client shows a confirmation screen before broadcast.
6. User confirms recipient, amount, fee, change, and total spend.
7. Client sends only the signed raw transaction to `/api/wallet/broadcast`.
8. Backend broadcasts the signed transaction and returns txid/status.

## 5. UI confirmation checklist

Before broadcast, the UI should show:

- Sender address.
- Recipient address.
- Recipient amount.
- Network fee.
- Total spend.
- Change amount and change address.
- Number of inputs and estimated transaction size.
- Warning that blockchain transactions cannot be reversed.
- Confirmation checkbox or explicit confirmation action.

## 6. Error handling

Use user-safe messages:

- `Invalid signed transaction payload.`
- `Broadcast failed. Please verify the transaction and try again.`
- `PEPEW Light API is temporarily unavailable.`
- `Transaction rejected by the network.`

Do not expose:

- Internal exception class names.
- ElectrumX host/port.
- Node RPC URL.
- Backend filesystem paths.
- Stack traces.

## 7. Test checklist

Backend tests:

- Reject missing `raw_tx`.
- Reject non-string `raw_tx`.
- Reject non-hex payload.
- Reject odd-length hex.
- Reject oversized payload.
- Return safe error shape.
- Apply rate limits.

Client tests:

- Mnemonic/private key is never sent to API.
- Broadcast request contains only signed raw transaction payload.
- Confirmation screen displays amount, fee, total spend, and change.
- Failed broadcast shows a safe user-facing error.
- Mobile layout remains readable.

## 8. Implementation rule

Do not add mnemonic, private key, WIF, seed derivation, or signing logic to `pepepow-electrumx-service`. Those functions belong only in the client-side wallet code.
