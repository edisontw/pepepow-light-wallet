import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildAndSignP2PKH, PEPEPOW, selectUtxos, type UTXO, wifFromMnemonic } from "@pepepow/wallet-core";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";
import { formatAtomicToPepew, parsePepewToAtomic, PEPEW_DECIMALS } from "../lib/amount";
import { pepewLightClient, LightAddressBalance, LightUtxo } from "../lib/pepewLightClient";

const DEFAULT_PATH = "m/44'/5'/0'/0/0";
const DEFAULT_FEE = "0.0001";
const DUST_ATOMIC = 546n;
const MAX_INPUTS = 80;

type SendPhase = "idle" | "loading_utxos" | "fetching_prevtx" | "signing" | "ready" | "broadcasting" | "broadcasted" | "error";

type SignedPreview = {
  rawTx: string;
  txBytes: number;
  selectedCount: number;
  totalIn: bigint;
  amount: bigint;
  fee: bigint;
  change: bigint;
};

function normalizeAddressInput(value: string) {
  if (!value) return "";
  const trimmed = value.trim();
  const withoutScheme = trimmed
    .replace(/^(pepepow|pepew):\/\//i, "")
    .replace(/^(pepepow|pepew):/i, "");
  return (withoutScheme.split("?")[0] || "").trim();
}

function parseAtomicInput(value: string) {
  try {
    const atomic = parsePepewToAtomic(value, PEPEW_DECIMALS);
    return atomic > 0n ? atomic : null;
  } catch {
    return null;
  }
}

function shortHex(value: string) {
  if (!value) return "--";
  if (value.length <= 96) return value;
  return `${value.slice(0, 96)}…${value.slice(-32)}`;
}

function extractRawTx(payload: any): string | null {
  const data = payload?.data ?? payload?.tx ?? payload;
  if (typeof data === "string" && /^[0-9a-fA-F]+$/.test(data)) return data;
  if (data && typeof data === "object") {
    const hex = data.hex ?? data.raw ?? data.rawTx;
    if (typeof hex === "string" && /^[0-9a-fA-F]+$/.test(hex)) return hex;
  }
  return null;
}

function formatAddressError(error: string | null) {
  if (!error) return null;
  if (/unsupported_address_prefix|invalid_address|bad_checksum|address_too_short|address_too_long/i.test(error)) {
    return "Invalid PEPEW address.";
  }
  return error;
}

function toWalletCoreUtxo(utxo: LightUtxo, rawTx: string): UTXO {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    value: String(utxo.value),
    nonWitnessUtxo: rawTx,
  };
}

export default function Send() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [fromAddress] = useState(localStorage.getItem("pepew_address") || "");
  const [mnemonic] = useState(localStorage.getItem("pepew_mnemonic") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [amount, setAmount] = useState(searchParams.get("amount") || "");
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [balance, setBalance] = useState<LightAddressBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signedPreview, setSignedPreview] = useState<SignedPreview | null>(null);
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null);

  const normalizedTo = useMemo(() => normalizeAddressInput(to), [to]);
  const amountAtomic = useMemo(() => parseAtomicInput(amount), [amount]);
  const feeAtomic = useMemo(() => parseAtomicInput(fee), [fee]);
  const confirmedAtomic = useMemo(() => {
    const n = BigInt(Math.max(0, Math.trunc(Number(balance?.confirmed ?? 0))));
    return n;
  }, [balance]);

  const validationError = useMemo(() => {
    if (!fromAddress) return "Create or import a wallet before sending.";
    if (!mnemonic) return "Mnemonic is missing in this browser. Import the wallet again before sending.";
    if (!normalizedTo) return "Enter a recipient PEPEW address.";
    if (!amountAtomic) return "Enter a valid send amount.";
    if (!feeAtomic) return "Enter a valid fee.";
    if (amountAtomic <= DUST_ATOMIC) return "Amount is below the dust threshold.";
    if (confirmedAtomic > 0n && amountAtomic + feeAtomic > confirmedAtomic) {
      return "Amount plus fee is greater than the confirmed balance.";
    }
    return null;
  }, [fromAddress, mnemonic, normalizedTo, amountAtomic, feeAtomic, confirmedAtomic]);

  useEffect(() => {
    if (!fromAddress) return;
    let active = true;
    const run = async () => {
      setBalanceLoading(true);
      setBalanceError(null);
      try {
        const data = await pepewLightClient.getAddress(fromAddress);
        if (!active) return;
        setBalance(data.balance);
      } catch (e: any) {
        if (!active) return;
        setBalance(null);
        setBalanceError(formatAddressError(e?.message || "PEPEW Light API balance lookup failed."));
      } finally {
        if (active) setBalanceLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [fromAddress]);

  useEffect(() => {
    setSignedPreview(null);
    setConfirmedReview(false);
    setBroadcastTxid(null);
    if (phase !== "idle") setPhase("idle");
  }, [to, amount, fee]);

  const buildSignedTx = async () => {
    if (validationError || !amountAtomic || !feeAtomic) {
      setError(validationError || "Invalid send form.");
      return;
    }
    setError(null);
    setSignedPreview(null);
    setConfirmedReview(false);
    setBroadcastTxid(null);

    try {
      setPhase("loading_utxos");
      const utxoResult = await pepewLightClient.getUtxo(fromAddress);
      const spendable = utxoResult.utxos.filter((u) => Number(u.height) > 0 && Number(u.value) > 0);
      if (!spendable.length) throw new Error("No confirmed UTXOs available for sending.");

      const target = amountAtomic + feeAtomic;
      const selected = selectUtxos(
        spendable.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value), nonWitnessUtxo: "00" })),
        target.toString(),
      );
      if (selected.picked.length > MAX_INPUTS) {
        throw new Error(`Too many inputs selected (${selected.picked.length}). Consolidation is required before sending.`);
      }

      const selectedKeys = new Set(selected.picked.map((u) => `${u.txid}:${u.vout}`));
      const selectedLight = spendable.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));

      setPhase("fetching_prevtx");
      const coreUtxos: UTXO[] = [];
      for (const item of selectedLight) {
        const tx = await pepewLightClient.getTx(item.txid, true);
        const rawTx = extractRawTx(tx);
        if (!rawTx) throw new Error(`Previous transaction raw hex unavailable for ${item.txid}.`);
        coreUtxos.push(toWalletCoreUtxo(item, rawTx));
      }

      setPhase("signing");
      const wif = await wifFromMnemonic(mnemonic, DEFAULT_PATH, PEPEPOW);
      const rawTx = buildAndSignP2PKH({
        network: PEPEPOW,
        utxos: coreUtxos,
        wif,
        to: normalizedTo,
        amount: amountAtomic.toString(),
        changeAddress: fromAddress,
        fee: feeAtomic.toString(),
      });
      const change = selected.total - amountAtomic - feeAtomic;
      setSignedPreview({
        rawTx,
        txBytes: rawTx.length / 2,
        selectedCount: coreUtxos.length,
        totalIn: selected.total,
        amount: amountAtomic,
        fee: feeAtomic,
        change,
      });
      setPhase("ready");
    } catch (e: any) {
      setError(e?.message || "Failed to build signed transaction.");
      setPhase("error");
    }
  };

  const broadcast = async () => {
    if (!signedPreview || !confirmedReview) return;
    setError(null);
    setPhase("broadcasting");
    try {
      const result = await pepewLightClient.broadcastSignedRawTx(signedPreview.rawTx);
      setBroadcastTxid(result.txid || null);
      setPhase("broadcasted");
      setConfirmedReview(false);
    } catch (e: any) {
      setError(e?.message || "Broadcast failed.");
      setPhase("error");
    }
  };

  const busy = phase === "loading_utxos" || phase === "fetching_prevtx" || phase === "signing" || phase === "broadcasting";

  return (
    <AppLayout>
      <PageCard title="Send PEPEW">
        <div className="card" style={{ border: "1px solid rgba(255, 170, 0, 0.45)", marginBottom: 12 }}>
          <div className="section-title">Client-side signing</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
            <div>Your mnemonic and private key stay in this browser.</div>
            <div>The server only receives the signed raw transaction after final confirmation.</div>
            <div>Review recipient, amount, fee, and change before broadcasting.</div>
          </div>
        </div>

        {!fromAddress ? (
          <div className="card">
            <p className="error">Create or import a wallet before sending.</p>
            <Link className="btn" to="/" style={{ textDecoration: "none" }}>{t("history.goReceive")}</Link>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="section-title">From</div>
              <code style={{ wordBreak: "break-all" }}>{fromAddress}</code>
              <div className="muted" style={{ marginTop: 8 }}>
                {balanceLoading ? "Loading confirmed balance..." : balance ? `Confirmed balance: ${balance.confirmed_pepew} PEPEW` : balanceError || "Balance unavailable."}
              </div>
            </div>

            <div className="card">
              <label className="field-label">Recipient address</label>
              <input
                className="input"
                placeholder="P..."
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={busy}
              />

              <div className="grid two" style={{ marginTop: 12 }}>
                <div>
                  <label className="field-label">Amount</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0.00000000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="field-label">Fee</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={DEFAULT_FEE}
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Review</div>
              <div style={{ marginTop: 8 }}><span className="muted">To: </span><code style={{ wordBreak: "break-all" }}>{normalizedTo || "--"}</code></div>
              <div style={{ marginTop: 8 }}><span className="muted">Amount: </span><strong>{amountAtomic ? `${formatAtomicToPepew(amountAtomic)} PEPEW` : "--"}</strong></div>
              <div style={{ marginTop: 8 }}><span className="muted">Fee: </span><strong>{feeAtomic ? `${formatAtomicToPepew(feeAtomic)} PEPEW` : "--"}</strong></div>
              {validationError && <p className="error" style={{ marginTop: 10 }}>{validationError}</p>}
              {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
              {phase !== "idle" && phase !== "ready" && phase !== "broadcasted" && (
                <p className="muted" style={{ marginTop: 10 }}>Status: {phase.replace(/_/g, " ")}</p>
              )}
              <button className="btn" onClick={buildSignedTx} disabled={busy || Boolean(validationError)} style={{ marginTop: 10 }}>
                Build signed transaction
              </button>
            </div>

            {signedPreview && (
              <div className="card">
                <div className="section-title">Signed transaction preview</div>
                <div className="grid two" style={{ marginTop: 8 }}>
                  <div><span className="muted">Inputs: </span><strong>{signedPreview.selectedCount}</strong></div>
                  <div><span className="muted">Size: </span><strong>{signedPreview.txBytes} bytes</strong></div>
                  <div><span className="muted">Total input: </span><strong>{formatAtomicToPepew(signedPreview.totalIn)} PEPEW</strong></div>
                  <div><span className="muted">Change: </span><strong>{formatAtomicToPepew(signedPreview.change)} PEPEW</strong></div>
                </div>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflow: "auto", marginTop: 10 }}>
                  {shortHex(signedPreview.rawTx)}
                </pre>
                <label className="row" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={confirmedReview}
                    onChange={(e) => setConfirmedReview(e.target.checked)}
                    disabled={phase === "broadcasting" || phase === "broadcasted"}
                  />
                  <span>I confirm the recipient, amount, fee, and change are correct.</span>
                </label>
                <button className="btn" onClick={broadcast} disabled={!confirmedReview || phase === "broadcasting" || phase === "broadcasted"} style={{ marginTop: 10 }}>
                  Broadcast signed transaction
                </button>
              </div>
            )}

            {phase === "broadcasted" && (
              <div className="card">
                <div className="section-title">Broadcast submitted</div>
                <p className="success">Transaction was submitted to PEPEW Light API.</p>
                {broadcastTxid && <div><span className="muted">TxID: </span><code style={{ wordBreak: "break-all" }}>{broadcastTxid}</code></div>}
                <Link className="btn secondary" to="/history" style={{ marginTop: 10, textDecoration: "none" }}>View history</Link>
              </div>
            )}
          </>
        )}
      </PageCard>
    </AppLayout>
  );
}
