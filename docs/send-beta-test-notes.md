# PEPEW Light Wallet Send Beta Test Notes

This document records the current public-beta send behavior for the PEPEW Light web wallet.

## Current status

- Web wallet smoke test: OK.
- Payment query test: OK.
- Small-amount send test: OK.
- Consecutive small sends: OK after automatic retry was added.
- Client-side signing: enabled.
- Broadcast flow: sends signed raw transaction hex only.
- Backend must not receive mnemonic, private key, WIF, seed, or unsigned signing material.

## Tested flow

1. Import mnemonic in the browser.
2. Derive the local PEPEW address client-side.
3. Load balance and UTXOs from PEPEW Light API.
4. Fetch previous raw transactions required for P2PKH signing.
5. Build and sign the transaction in the browser.
6. Submit only signed raw transaction hex to the broadcast API.
7. Display returned txid.
8. Allow another send after local UTXO/indexer retry.

## Consecutive send behavior

After a successful broadcast, the wallet records recently spent outpoints in browser storage for a short period. This reduces the chance of selecting the same UTXO again before the API/indexer catches up.

The wallet also retries automatically when:

- UTXO state is still updating after a previous send.
- Change output from the previous transaction has not appeared yet.
- Previous raw transaction data is not immediately available.

Current retry behavior:

- UTXO retry: 5 attempts, 1.2 seconds apart.
- Previous raw tx retry: 4 attempts, 1.2 seconds apart.

Expected visible messages during retry:

```text
Waiting for wallet UTXOs to update... retry 1/5
Waiting for previous transaction data... retry 1/4
```

## Known limitations

- This is still public-beta wallet functionality.
- Test with small amounts first.
- API/indexer updates may lag for several seconds after broadcast.
- Consecutive sends can depend on unconfirmed change being visible through the API.
- The current browser wallet stores mnemonic material locally in the browser. Future hardening should consider session-only or encrypted browser storage.
- The wallet is non-custodial; lost mnemonic means lost access.

## Safety boundary

The wallet must preserve these rules:

1. Mnemonic and private keys stay client-side only.
2. Signing happens only in the browser.
3. Backend receives signed raw tx only.
4. Backend never accepts mnemonic, private key, WIF, seed, or signing requests.
5. ElectrumX remains behind the PEPEW Light API gateway and is not exposed directly.
6. Error messages should not leak backend internals.

## Suggested regression tests

Before public beta announcements, retest:

- Import mnemonic.
- Load balance.
- Load history.
- Check payment query.
- Send a small amount.
- Send 2-3 consecutive small transactions.
- Confirm retry message appears only when the API/indexer is catching up.
- Confirm the returned txid opens in history or explorer.
- Confirm no private key, WIF, seed, or mnemonic is sent over the network.

## Current test result

As of this note:

- docs cleanup: OK.
- payment query: OK.
- web wallet smoke test: OK.
- small-amount send: OK.
- consecutive sends after automatic retry: OK.
