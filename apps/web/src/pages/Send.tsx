import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildAndSignP2PKH, PEPEPOW, selectUtxos, type UTXO, wifFromMnemonic } from "@pepepow/wallet-core";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";
import { parsePepewToAtomic, PEPEW_DECIMALS } from "../lib/amount";
import { pepewLightClient, LightAddressBalance, LightUtxo } from "../lib/pepewLightClient";

const DEFAULT_PATH = "m/44'/5'/0'/0/0";
const DEFAULT_FEE = "0.0001";
const DUST_ATOMIC = 546n;
const MAX_INPUTS = 80;
const RECENT_RECIPIENTS_KEY = "pepew_recent_recipients";
const MAX_RECENT_RECIPIENTS = 8;

type SendPhase = "idle" | "loading_utxos" | "fetching_prevtx" | "signing" | "ready" | "broadcasting" | "broadcasted" | "error";

type SignedPreview = {
  rawTx: string;
};

type RecentRecipient = {
  address: string;
  lastUsedAt: number;
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

function shortAddress(value: string) {
  if (!value) return "--";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
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

function loadRecentRecipients(): RecentRecipient[] {
  try {
    const raw = localStorage.getItem(RECENT_RECIPIENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.address === "string" && item.address)
      .map((item) => ({ address: item.address, lastUsedAt: Number(item.lastUsedAt || 0) }))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_RECENT_RECIPIENTS);
  } catch {
    return [];
  }
}

function saveRecentRecipient(address: string) {
  const normalized = normalizeAddressInput(address);
  if (!normalized) return loadRecentRecipients();
  const next = [
    { address: normalized, lastUsedAt: Date.now() },
    ...loadRecentRecipients().filter((item) => item.address !== normalized),
  ].slice(0, MAX_RECENT_RECIPIENTS);
  localStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(next));
  return next;
}

export default function Send() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [fromAddress] = useState(localStorage.getItem("pepew_address") || "");
  const [mnemonic] = useState(localStorage.getItem("pepew_mnemonic") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [amount, setAmount] = useState(searchParams.get("amount") || "");
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [subtractFee, setSubtractFee] = useState(false);
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>(() => loadRecentRecipients());
  const [balance, setBalance] = useState<LightAddressBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signedPreview, setSignedPreview] = useState<SignedPreview | null>(null);
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null);
  const [attemptedSend, setAttemptedSend] = useState(false);

  const normalizedTo = useMemo(() => normalizeAddressInput(to), [to]);
  const amountAtomic = useMemo(() => parseAtomicInput(amount), [amount]);
  const feeAtomic = useMemo(() => parseAtomicInput(fee), [fee]);
  const recipientAmountAtomic = useMemo(() => {
    if (!amountAtomic || !feeAtomic) return null;
    return subtractFee ? amountAtomic - feeAtomic : amountAtomic;
  }, [amountAtomic, feeAtomic, subtractFee]);
  const totalSpentAtomic = useMemo(() => {
    if (!amountAtomic || !feeAtomic) return null;
    return subtractFee ? amountAtomic : amountAtomic + feeAtomic;
  }, [amountAtomic, feeAtomic, subtractFee]);
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
    if (!recipientAmountAtomic || recipientAmountAtomic <= DUST_ATOMIC) return "Recipient amount is below the dust threshold after fee.";
    if (!totalSpentAtomic || totalSpentAtomic <= 0n) return "Total spent amount is invalid.";
    if (confirmedAtomic > 0n && totalSpentAtomic > confirmedAtomic) {
      return "Amount and fee are greater than the confirmed balance.";
    }
    return null;
  }, [fromAddress, mnemonic, normalizedTo, amountAtomic, feeAtomic, recipientAmountAtomic, totalSpentAtomic, confirmedAtomic]);

  const displayValidationError = attemptedSend ? validationError : null;

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
    setBroadcastTxid(null);
    setError(null);
    if (phase !== "idle") setPhase("idle");
  }, [to, amount, fee, subtractFee]);

  const buildSignedTx = async () => {
    if (validationError || !recipientAmountAtomic || !feeAtomic || !totalSpentAtomic) {
      setError(validationError || "Invalid send form.");
      return null;
    }
    setError(null);
    setSignedPreview(null);
    setBroadcastTxid(null);

    try {
      setPhase("loading_utxos");
      const utxoResult = await pepewLightClient.getUtxo(fromAddress);
      const spendable = utxoResult.utxos.filter((u) => Number(u.height) > 0 && Number(u.value) > 0);
      if (!spendable.length) throw new Error("No confirmed UTXOs available for sending.");

      const selected = selectUtxos(
        spendable.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value), nonWitnessUtxo: "00" })),
        totalSpentAtomic.toString(),
      );
      if (selected.picked.length > MAX_INPUTS) {
        throw new Error(`Too many inputs selected (${selected.picked.length}). Use Advanced consolidation first.`);
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
        amount: recipientAmountAtomic.toString(),
        changeAddress: fromAddress,
        fee: feeAtomic.toString(),
      });
      const preview = { rawTx };
      setSignedPreview(preview);
      setPhase("ready");
      return preview;
    } catch (e: any) {
      setError(e?.message || "Failed to prepare transaction.");
      setPhase("error");
      return null;
    }
  };

  const broadcast = async (preview = signedPreview) => {
    if (!preview) return;
    setError(null);
    setPhase("broadcasting");
    try {
      const result = await pepewLightClient.broadcastSignedRawTx(preview.rawTx);
      setBroadcastTxid(result.txid || null);
      setRecentRecipients(saveRecentRecipient(normalizedTo));
      setPhase("broadcasted");
    } catch (e: any) {
      setError(e?.message || "Broadcast failed.");
      setPhase("error");
    }
  };

  const handlePrimarySend = async () => {
    setAttemptedSend(true);
    if (validationError) {
      setError(null);
      return;
    }
    const preview = await buildSignedTx();
    if (preview) await broadcast(preview);
  };

  const busy = phase === "loading_utxos" || phase === "fetching_prevtx" || phase === "signing" || phase === "broadcasting";
  const primaryButtonLabel = phase === "broadcasting" ? "Broadcasting..." : "Send PEPEW";
  const consolidationNeeded = balance && Number((balance as any).history_count || 0) > 50;

  return (
    <AppLayout>
      <PageCard title="Send PEPEW">
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
              {recentRecipients.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>Recent recipients</div>
                  <div className="row" style={{ gap: 8 }}>
                    {recentRecipients.map((item) => (
                      <button
                        key={item.address}
                        className="btn ghost small"
                        type="button"
                        onClick={() => setTo(item.address)}
                        disabled={busy}
                        title={item.address}
                      >
                        {shortAddress(item.address)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
              <label className="row" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={subtractFee}
                  onChange={(e) => setSubtractFee(e.target.checked)}
                  disabled={busy}
                />
                <span>Subtract fee from amount</span>
              </label>
            </div>

            <div className="card">
              <div className="section-title">Send</div>
              <p className="muted" style={{ marginTop: 8 }}>
                Please verify the recipient address carefully. Blockchain transactions cannot be reversed.
              </p>
              <p className="muted" style={{ marginTop: 6 }}>
                請確認收款地址正確。區塊鏈交易送出後無法取消或追回。
              </p>
              {displayValidationError && <p className="error" style={{ marginTop: 10 }}>{displayValidationError}</p>}
              {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
              {phase !== "idle" && phase !== "ready" && phase !== "broadcasted" && (
                <p className="muted" style={{ marginTop: 10 }}>Status: {phase.replace(/_/g, " ")}</p>
              )}
              <button
                className="btn"
                onClick={handlePrimarySend}
                disabled={busy || phase === "broadcasted"}
                style={{ marginTop: 10 }}
              >
                {primaryButtonLabel}
              </button>
            </div>

            <details className="details">
              <summary>Advanced: UTXO consolidation assessment</summary>
              <div style={{ marginTop: 8 }} className="muted">
                Consolidation can combine many small confirmed UTXOs into one output to your own current wallet address. It is optional, spends a transaction fee, and should remain a manual action.
              </div>
              <div style={{ marginTop: 8 }}>
                Current send input limit: <strong>{MAX_INPUTS}</strong>. If a send needs more inputs, split the payment or consolidate UTXOs first.
              </div>
              {consolidationNeeded && <p className="muted">This wallet may benefit from consolidation later. Full consolidation broadcast is intentionally not automated.</p>}
            </details>

            {phase === "broadcasted" && (
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="section-title">Broadcast submitted</div>
                <p className="success" style={{ margin: 0 }}>Transaction was submitted to PEPEW Light API.</p>
                {broadcastTxid && (
                  <div>
                    <span className="muted">TxID: </span>
                    <code style={{ display: "inline-block", maxWidth: "100%", wordBreak: "break-all", overflowWrap: "anywhere", lineHeight: 1.4 }}>
                      {broadcastTxid}
                    </code>
                  </div>
                )}
                <div>
                  <Link className="btn secondary" to="/history" style={{ textDecoration: "none" }}>View history</Link>
                </div>
              </div>
            )}
          </>
        )}
      </PageCard>
    </AppLayout>
  );
}
