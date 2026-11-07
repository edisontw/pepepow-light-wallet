# PEPEW Light Wallet — UTXO consolidation modes

Applies to `https://light.pepepow.net/wallet/send`, implemented in `apps/web/src/pages/Send.tsx`.

## Modes

- **Manual:** user previews one set of 20, 40 or 80 confirmed UTXOs and explicitly confirms one on-chain transaction.
- **Automatic:** user previews the first batch, selects a limit of 1, 2, 3 or 5 rounds, reviews the approximate **maximum cumulative fee** and authorizes the entire bounded session once. The wallet submits at most that number of independent transactions; each round requires indexer visibility and confirmation of the **previous** consolidation output before the next round starts.
- Each transaction merges selected confirmed spendable outputs back into the **same, locally-derived wallet address**, using the existing `wallet-core` browser signer. The API accepts **signed raw transactions only**.
- The fee estimate is **100,000 atomic units (0.001 PEPEW) per started kB** of estimated legacy P2PKH transaction size; signing checks the *actual* serialized size again before broadcast.
- No new backend endpoints, wallet addresses, custodial storage, or server-side signing.

## Safety and resource policy

- Maximum **80 inputs** per round; no unconfirmed inputs, duplicate outpoints or locally marked recently-spent outpoints.
- Before every transaction, re-fetch UTXOs, verify selected outpoints still exist unchanged and confirmed, and verify the locally derived wallet address matches the destination.
- After a successful broadcast, the next round is blocked until **all previously selected inputs disappear** and the new consolidation output is **confirmed** in the Light API UTXO snapshot.
- Indexer polling is bounded: **12 seconds** between requests and **20 attempts per round** (normally approximately four minutes, plus API latency). This avoids high-frequency load on the single-core gateway.
- If a transaction cannot be verified as indexed/confirmed within the polling window, the loop **pauses**. A rejected, failed or *ambiguous* broadcast is never blindly retried.
- The **Pause further batches** button prevents another round, but cannot retract an in-flight transaction. A browser tab entering the background also stops future rounds; the user should keep the tab foregrounded.
- There is **no automatic resume after reload/navigation**. Check transaction history and obtain a fresh preview before intentionally starting another session.
- Manual and automatic processing are mutually exclusive with regular Send UI actions in the current tab during a running operation. Do not run the wallet in parallel signing tabs.

## Source and verification

- Selection, fee and dust checks: `apps/web/src/lib/consolidationPolicy.ts`.
- Bounded automatic runner and confirmation barrier: `apps/web/src/lib/consolidationAuto.ts`.
- Tests: `npm --prefix apps/web run test:consolidation`.
- Build: `npm --prefix packages/wallet-core run build`, then `npm --prefix apps/web run build`.

### Acceptance checklist (requires user with a test wallet)

1. Manual mode preview/cancel; verify own address, fee and number of confirmed inputs.
2. Auto mode preview shows first-round fee and selected maximum cumulative fee for 1–5 rounds.
3. Test with a small set of confirmed UTXOs and no secrets shared to ChatGPT or the server.
4. Confirm automatic mode does **not** submit the second round while prior consolidation output is unconfirmed.
5. Confirm Pause stops additional rounds; confirm successful broadcasts show TxID, and Refresh UTXOs reflects indexed state.
6. Confirm API/network errors halt safely without repeat broadcast.

Production deployment: use `docs/deploy-light-pepepow-net.md`. Frontend-only static deploy; no ElectrumX, PEPEPOWd or FastAPI restart.
