import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildAndSignP2PKH, deriveFromMnemonic, PEPEPOW, pubkeyToP2PKH, selectUtxos, type UTXO, wifFromMnemonic } from "@pepepow/wallet-core";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";
import { parsePepewToAtomic, PEPEW_DECIMALS } from "../lib/amount";
import { pepewLightClient, LightAddressBalance, LightUtxo } from "../lib/pepewLightClient";
import { MAX_CONSOLIDATION_TX_BYTES, prepareConsolidationPlan, type ConsolidationPlan } from "../lib/consolidationPolicy";
import { estimateAutoConsolidation, runAutoConsolidation, type AutoConsolidationProgress } from "../lib/consolidationAuto";

const DEFAULT_PATH = "m/44'/5'/0'/0/0";
const DEFAULT_FEE = "0.0001";
const DUST_ATOMIC = 546n;
const MAX_INPUTS = 150;
const PREV_TX_FETCH_CONCURRENCY = 6;
const RECENT_RECIPIENTS_KEY = "pepew_recent_recipients";
const MAX_RECENT_RECIPIENTS = 8;
const SPENT_OUTPOINTS_KEY = "pepew_recent_spent_outpoints";
// Keep local anti-double-spend markers long enough for the API/indexer to stop returning spent outputs.
const SPENT_OUTPOINT_TTL_MS = 10 * 60 * 1000;
const MAX_RECENT_SPENT_OUTPOINTS = 2000;
const UTXO_RETRY_ATTEMPTS = 5;
const UTXO_RETRY_DELAY_MS = 1200;
const PREV_TX_RETRY_ATTEMPTS = 4;
const PREV_TX_RETRY_DELAY_MS = 1200;

type SendPhase = "idle" | "loading_utxos" | "fetching_prevtx" | "signing" | "broadcasting" | "broadcasted" | "error";

class AmbiguousConsolidationBroadcastError extends Error {}

type RecentRecipient = {
  address: string;
  lastUsedAt: number;
};

type SpentOutpointRecord = {
  key: string;
  expiresAt: number;
};

type SendPreview = {
  rawTx: string;
  spentOutpoints: string[];
  selectedInputCount: number;
  selectedUnconfirmedCount: number;
  selectedTotalAtomic: bigint;
  recipientAmountAtomic: bigint;
  feeAtomic: bigint;
  changeAtomic: bigint;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function atomicFromUtxoValue(value: number) {
  return BigInt(Math.max(0, Math.trunc(Number(value))));
}

function formatAtomicAsPepew(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / 100000000n;
  const frac = (abs % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

function shortAddress(value: string) {
  if (!value) return "--";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function outpointKey(utxo: Pick<LightUtxo, "txid" | "vout">) {
  return `${utxo.txid}:${utxo.vout}`;
}

function loadRecentSpentOutpoints() {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(SPENT_OUTPOINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set<string>();
    const valid = parsed
      .filter((item) => typeof item?.key === "string" && Number(item.expiresAt || 0) > now)
      .slice(0, MAX_RECENT_SPENT_OUTPOINTS);
    localStorage.setItem(SPENT_OUTPOINTS_KEY, JSON.stringify(valid));
    return new Set<string>(valid.map((item) => item.key));
  } catch {
    return new Set<string>();
  }
}

function saveRecentSpentOutpoints(keys: string[]) {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(SPENT_OUTPOINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const keySet = new Set(keys.filter(Boolean));
    const kept: SpentOutpointRecord[] = Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.key === "string" && Number(item.expiresAt || 0) > now && !keySet.has(item.key))
      : [];
    const added = [...keySet].map((key) => ({ key, expiresAt: now + SPENT_OUTPOINT_TTL_MS }));
    const next = [...added, ...kept].slice(0, MAX_RECENT_SPENT_OUTPOINTS);
    localStorage.setItem(SPENT_OUTPOINTS_KEY, JSON.stringify(next));
    return new Set<string>(next.map((item) => item.key));
  } catch {
    return loadRecentSpentOutpoints();
  }
}

function reconcileRecentSpentOutpoints(utxos: LightUtxo[]) {
  try {
    const now = Date.now();
    const availableKeys = new Set(utxos.map(outpointKey));
    const raw = localStorage.getItem(SPENT_OUTPOINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const kept: SpentOutpointRecord[] = Array.isArray(parsed)
      ? parsed.filter((item) =>
          typeof item?.key === "string" &&
          Number(item.expiresAt || 0) > now &&
          availableKeys.has(item.key)
        )
      : [];
    localStorage.setItem(SPENT_OUTPOINTS_KEY, JSON.stringify(kept));
    return new Set<string>(kept.map((item) => item.key));
  } catch {
    return loadRecentSpentOutpoints();
  }
}

function spendableUtxos(utxos: LightUtxo[], excludedOutpoints: Set<string>) {
  return utxos
    .filter((u) => Number(u.value) > 0 && !excludedOutpoints.has(outpointKey(u)))
    .sort((a, b) => {
      const aConfirmed = Number(a.height) > 0 ? 1 : 0;
      const bConfirmed = Number(b.height) > 0 ? 1 : 0;
      if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed;
      return Number(a.value) - Number(b.value);
    });
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

function safeError(error: any, fallback: string) {
  const raw = String(error?.message || error || "");
  if (/unsupported_address_prefix|invalid_address|bad_checksum|address_too_short|address_too_long/i.test(raw)) return "Invalid PEPEW address.";
  if (/insufficient|not enough/i.test(raw)) return raw;
  if (/timeout|timed out/i.test(raw)) return "PEPEW Light API request timed out. Please try again.";
  if (/already spent|missing inputs|txn-mempool-conflict|bad-txns-inputs/i.test(raw)) return "One or more selected UTXOs were already spent or not yet indexed. Press Refresh UTXOs and try again.";
  if (/raw hex unavailable/i.test(raw)) return "Previous transaction data is not available yet. Press Refresh UTXOs or wait for the API to index the latest transaction.";
  return fallback;
}

function toWalletCoreUtxo(utxo: LightUtxo, rawTx: string): UTXO {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    value: String(utxo.value),
    nonWitnessUtxo: rawTx,
  };
}

async function fetchCoreUtxosWithLimit(selectedLight: LightUtxo[], onRetry?: (attempt: number) => void): Promise<UTXO[]> {
  const results: UTXO[] = new Array(selectedLight.length);
  let nextIndex = 0;

  async function fetchRawTxWithRetry(item: LightUtxo) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= PREV_TX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const tx = await pepewLightClient.getTx(item.txid, true);
        const rawTx = extractRawTx(tx);
        if (rawTx) return rawTx;
        lastError = new Error(`Previous transaction raw hex unavailable for ${item.txid}.`);
      } catch (e) {
        lastError = e;
      }
      if (attempt < PREV_TX_RETRY_ATTEMPTS) {
        onRetry?.(attempt + 1);
        await sleep(PREV_TX_RETRY_DELAY_MS);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Previous transaction raw hex unavailable for ${item.txid}.`);
  }

  async function worker() {
    while (nextIndex < selectedLight.length) {
      const index = nextIndex;
      nextIndex += 1;

      const item = selectedLight[index];
      const rawTx = await fetchRawTxWithRetry(item);
      results[index] = toWalletCoreUtxo(item, rawTx);
    }
  }

  const workerCount = Math.min(PREV_TX_FETCH_CONCURRENCY, selectedLight.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null);
  const [attemptedSend, setAttemptedSend] = useState(false);
  const [spentOutpoints, setSpentOutpoints] = useState<Set<string>>(() => loadRecentSpentOutpoints());
  const [consolidationOpen, setConsolidationOpen] = useState(false);
  const [consolidationCap, setConsolidationCap] = useState(40);
  const [consolidationMode, setConsolidationMode] = useState<"manual" | "auto">("manual");
  const [autoProgress, setAutoProgress] = useState<AutoConsolidationProgress | null>(null);
  const [autoPauseRequested, setAutoPauseRequested] = useState(false);
  const [consolidationResultNote, setConsolidationResultNote] = useState("");
  const autoStopRef = useRef(false);
  const autoRunningRef = useRef(false);
  const [consolidationPreview, setConsolidationPreview] = useState<ConsolidationPlan<LightUtxo> | null>(null);
  const [consolidationBusy, setConsolidationBusy] = useState(false);
  const [consolidationPhase, setConsolidationPhase] = useState("");
  const [consolidationError, setConsolidationError] = useState<string | null>(null);
  const [consolidationTxid, setConsolidationTxid] = useState<string | null>(null);
  const consolidationLock = useRef(false);
  const autoEstimate = useMemo(
    () => consolidationMode === "auto" && consolidationPreview
      ? estimateAutoConsolidation(consolidationPreview.totalCandidates, consolidationCap)
      : null,
    [consolidationMode, consolidationPreview, consolidationCap],
  );

  useEffect(() => {
    // Browser-only automation may continue in an open background tab, subject to
    // browser timer throttling. Navigating away or unmounting stops future rounds.
    return () => { autoStopRef.current = true; };
  }, []);

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

  const validationError = useMemo(() => {
    if (!fromAddress) return "Create or import a wallet before sending.";
    if (!mnemonic) return "Mnemonic is missing in this browser. Import the wallet again before sending.";
    if (!normalizedTo) return "Enter a recipient PEPEW address.";
    if (!amountAtomic) return "Enter a valid send amount.";
    if (!feeAtomic) return "Enter a valid fee.";
    if (!recipientAmountAtomic || recipientAmountAtomic <= DUST_ATOMIC) return "Recipient amount is below the dust threshold after fee.";
    if (!totalSpentAtomic || totalSpentAtomic <= 0n) return "Total spent amount is invalid.";
    return null;
  }, [fromAddress, mnemonic, normalizedTo, amountAtomic, feeAtomic, recipientAmountAtomic, totalSpentAtomic]);

  const busy = consolidationBusy || phase === "loading_utxos" || phase === "fetching_prevtx" || phase === "signing" || phase === "broadcasting";
  const displayValidationError = attemptedSend ? validationError : null;

  const refreshBalance = async () => {
    if (!fromAddress) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const data = await pepewLightClient.getAddress(fromAddress);
      setBalance(data.balance);
    } catch (e: any) {
      setBalance(null);
      setBalanceError(safeError(e, "PEPEW Light API balance lookup failed."));
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    void refreshBalance();
  }, [fromAddress]);

  useEffect(() => {
    setPreview(null);
    setBroadcastTxid(null);
    setError(null);
    if (phase !== "idle") setPhase("idle");
  }, [to, amount, fee, subtractFee]);

  const markOutpointsSpent = (keys: string[]) => {
    if (!keys.length) return;
    const next = saveRecentSpentOutpoints(keys);
    setSpentOutpoints(next);
  };

  const loadSpendableSnapshot = async () => {
    const utxoResult = await pepewLightClient.getUtxo(fromAddress);
    const latestSpent = reconcileRecentSpentOutpoints(utxoResult.utxos);
    const spendable = spendableUtxos(utxoResult.utxos, latestSpent);
    const spendableTotal = spendable.reduce((sum, item) => sum + atomicFromUtxoValue(item.value), 0n);
    return { latestSpent, spendable, spendableTotal };
  };

  const buildSignedTx = async () => {
    if (validationError || !recipientAmountAtomic || !feeAtomic || !totalSpentAtomic) {
      setError(validationError || "Invalid send form.");
      return null;
    }

    setError(null);
    setPreview(null);
    setBroadcastTxid(null);

    try {
      setPhase("loading_utxos");
      let snapshot = await loadSpendableSnapshot();
      setSpentOutpoints(snapshot.latestSpent);

      for (let attempt = 0; snapshot.spendableTotal < totalSpentAtomic && attempt < UTXO_RETRY_ATTEMPTS; attempt += 1) {
        setError(`Waiting for wallet UTXOs to update... retry ${attempt + 1}/${UTXO_RETRY_ATTEMPTS}`);
        await sleep(UTXO_RETRY_DELAY_MS);
        snapshot = await loadSpendableSnapshot();
        setSpentOutpoints(snapshot.latestSpent);
      }
      setError(null);

      const spendable = snapshot.spendable;
      const spendableTotal = snapshot.spendableTotal;

      if (!spendable.length) {
        throw new Error("No spendable UTXOs are available yet. Press Refresh UTXOs or wait for the latest transaction to be indexed.");
      }
      if (spendableTotal < totalSpentAtomic) {
        throw new Error("Insufficient spendable funds. The wallet may be waiting for change from a previous transaction or for the API indexer to update.");
      }

      const selected = selectUtxos(
        spendable.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value), nonWitnessUtxo: "00" })),
        totalSpentAtomic.toString(),
      );
      if (selected.picked.length > MAX_INPUTS) {
        throw new Error(`Too many inputs selected (${selected.picked.length}). Consolidate UTXOs first.`);
      }

      const selectedKeys = new Set(selected.picked.map((u) => `${u.txid}:${u.vout}`));
      const selectedLight = spendable.filter((u) => selectedKeys.has(outpointKey(u)));
      const selectedOutpoints = selectedLight.map(outpointKey);
      const selectedTotalAtomic = selectedLight.reduce((sum, item) => sum + atomicFromUtxoValue(item.value), 0n);
      const selectedUnconfirmedCount = selectedLight.filter((u) => Number(u.height) <= 0).length;
      const changeAtomic = selectedTotalAtomic - totalSpentAtomic;

      setPhase("fetching_prevtx");
      const coreUtxos = await fetchCoreUtxosWithLimit(selectedLight, (attempt) => {
        setError(`Waiting for previous transaction data... retry ${attempt}/${PREV_TX_RETRY_ATTEMPTS}`);
      });
      setError(null);

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

      const nextPreview: SendPreview = {
        rawTx,
        spentOutpoints: selectedOutpoints,
        selectedInputCount: selectedLight.length,
        selectedUnconfirmedCount,
        selectedTotalAtomic,
        recipientAmountAtomic,
        feeAtomic,
        changeAtomic,
      };
      setPreview(nextPreview);
      setPhase("idle");
      return nextPreview;
    } catch (e: any) {
      setError(safeError(e, "Failed to prepare transaction."));
      setPhase("error");
      return null;
    }
  };

  const broadcast = async (nextPreview = preview) => {
    if (!nextPreview) return;
    setError(null);
    setPhase("broadcasting");
    try {
      const result = await pepewLightClient.broadcastSignedRawTx(nextPreview.rawTx);
      markOutpointsSpent(nextPreview.spentOutpoints);
      setBroadcastTxid(result.txid || null);
      setRecentRecipients(saveRecentRecipient(normalizedTo));
      setPhase("broadcasted");
      setTimeout(() => void refreshBalance(), 1200);
    } catch (e: any) {
      setError(safeError(e, "Broadcast failed."));
      setPhase("error");
    }
  };

  const handlePrimarySend = async () => {
    setAttemptedSend(true);
    if (validationError) {
      setError(null);
      return;
    }
    const nextPreview = await buildSignedTx();
    if (nextPreview) await broadcast(nextPreview);
  };

  const refreshUtxoState = async () => {
    setError(null);
    setPreview(null);
    setBroadcastTxid(null);
    setConsolidationPreview(null);
    try {
      const utxoResult = await pepewLightClient.getUtxo(fromAddress);
      setSpentOutpoints(reconcileRecentSpentOutpoints(utxoResult.utxos));
    } catch {
      setSpentOutpoints(loadRecentSpentOutpoints());
    }
    await refreshBalance();
    if (phase === "error") setPhase("idle");
  };

  const prepareConsolidation = async () => {
    if (busy || consolidationLock.current) return;
    if (!mnemonic || !fromAddress) {
      setConsolidationError("Import a wallet with local signing keys before consolidating.");
      return;
    }
    consolidationLock.current = true;
    setConsolidationBusy(true);
    setConsolidationPhase(t("wallet.send.consolidateLoading"));
    setConsolidationError(null);
    setConsolidationPreview(null);
    setConsolidationTxid(null);
    setConsolidationResultNote("");
    setAutoProgress(null);
    try {
      const snapshot = await pepewLightClient.getUtxo(fromAddress);
      const recentlySpent = reconcileRecentSpentOutpoints(snapshot.utxos);
      setSpentOutpoints(recentlySpent);
      const nextPlan = prepareConsolidationPlan(snapshot.utxos, recentlySpent, consolidationCap);
      if (consolidationMode === "auto") estimateAutoConsolidation(nextPlan.totalCandidates, consolidationCap);
      setConsolidationPreview(nextPlan);
    } catch (e) {
      setConsolidationError(safeError(e, "Unable to prepare consolidation. Refresh UTXOs and retry."));
    } finally {
      setConsolidationPhase("");
      setConsolidationBusy(false);
      consolidationLock.current = false;
    }
  };

  const broadcastConsolidationPlan = async (plan: ConsolidationPlan<LightUtxo>): Promise<string> => {
    const keys = plan.selected.map(outpointKey);
    let broadcastAttempted = false;
    try {
      setConsolidationPhase(t("wallet.send.consolidateRechecking"));
      const latest = await pepewLightClient.getUtxo(fromAddress);
      const recentlySpent = reconcileRecentSpentOutpoints(latest.utxos);
      setSpentOutpoints(recentlySpent);
      const current = new Map(latest.utxos.map((u) => [outpointKey(u), u]));
      for (const input of plan.selected) {
        const fresh = current.get(outpointKey(input));
        if (!fresh || fresh.height <= 0 || fresh.value !== input.value || recentlySpent.has(outpointKey(input))) {
          throw new Error("Inputs changed since preview. Prepare a new batch.");
        }
      }
      // The one-address wallet may only consolidate to its own locally derived address.
      const node = await deriveFromMnemonic(mnemonic, DEFAULT_PATH);
      if (!node.publicKey || pubkeyToP2PKH(Buffer.from(node.publicKey), PEPEPOW) !== fromAddress) {
        throw new Error("The local signing key does not control this wallet address.");
      }
      setConsolidationPhase(t("wallet.send.consolidateFetching"));
      const coreInputs = await fetchCoreUtxosWithLimit(plan.selected);
      setConsolidationPhase(t("wallet.send.consolidateSigning"));
      const wif = await wifFromMnemonic(mnemonic, DEFAULT_PATH, PEPEPOW);
      const rawTx = buildAndSignP2PKH({
        network: PEPEPOW, utxos: coreInputs, wif, to: fromAddress,
        amount: plan.outputAtomic.toString(), changeAddress: fromAddress, fee: plan.feeAtomic.toString(),
      });
      if (!/^[0-9a-fA-F]+$/.test(rawTx) || rawTx.length % 2 !== 0 || rawTx.length / 2 > MAX_CONSOLIDATION_TX_BYTES) {
        throw new Error("Signed consolidation transaction exceeds the safety limit.");
      }
      const actualBytes = BigInt(rawTx.length / 2);
      const minimumFee = ((actualBytes + 999n) / 1000n) * 100_000n;
      if (plan.feeAtomic < minimumFee) {
        throw new Error("Signed transaction exceeded the fee estimate. Choose a smaller batch.");
      }
      setConsolidationPhase(t("wallet.send.consolidateBroadcasting"));
      broadcastAttempted = true;
      const result = await pepewLightClient.broadcastSignedRawTx(rawTx);
      if (!result.ok || !result.txid || !/^[0-9a-fA-F]{64}$/.test(result.txid)) {
        throw new Error("Broadcast status could not be verified.");
      }
      markOutpointsSpent(keys);
      setConsolidationTxid(result.txid);
      setTimeout(() => void refreshBalance(), 1500);
      return result.txid;
    } catch (e) {
      // A timeout after submission is ambiguous. Never automatically retry these inputs.
      if (broadcastAttempted) {
        markOutpointsSpent(keys);
        throw new AmbiguousConsolidationBroadcastError(t("wallet.send.consolidateBroadcastUncertain"));
      }
      throw e;
    }
  };

  const confirmConsolidation = async () => {
    const plan = consolidationPreview;
    if (!plan || busy || consolidationLock.current) return;
    consolidationLock.current = true;
    setConsolidationBusy(true);
    setConsolidationError(null);
    setConsolidationResultNote("");
    try {
      await broadcastConsolidationPlan(plan);
      setConsolidationPreview(null);
    } catch (e) {
      setConsolidationPreview(null);
      setConsolidationError(e instanceof AmbiguousConsolidationBroadcastError
        ? e.message : safeError(e, t("wallet.send.consolidateFailed")));
    } finally {
      setConsolidationPhase("");
      setConsolidationBusy(false);
      consolidationLock.current = false;
    }
  };

  const startAutoConsolidation = async () => {
    const first = consolidationPreview;
    if (!first || busy || consolidationLock.current) return;
    consolidationLock.current = true;
    autoRunningRef.current = true;
    autoStopRef.current = false;
    setAutoPauseRequested(false);
    setConsolidationBusy(true);
    setConsolidationError(null);
    setConsolidationResultNote("");
    setAutoProgress(null);
    // One preview authorizes exactly the rounds and cumulative fee estimated from
    // currently eligible UTXOs. No per-round human approval or automatic restart.
    try {
      const estimate = estimateAutoConsolidation(first.totalCandidates, consolidationCap);
      const outcome = await runAutoConsolidation({
        initialPlan: first,
        batchSize: consolidationCap,
        maxRounds: estimate.rounds,
        maxTotalFeeAtomic: estimate.estimatedTotalFeeAtomic,
        getUtxos: async () => {
          const snapshot = await pepewLightClient.getUtxo(fromAddress);
          setSpentOutpoints(reconcileRecentSpentOutpoints(snapshot.utxos));
          return snapshot.utxos;
        },
        getExcludedOutpoints: () => loadRecentSpentOutpoints(),
        broadcastRound: broadcastConsolidationPlan,
        isPaused: () => autoStopRef.current,
        onProgress: (progress) => {
          setAutoProgress(progress);
          if (progress.phase !== "broadcasting") setConsolidationPhase("");
        },
      });
      setConsolidationPreview(null);
      setConsolidationResultNote(t(`wallet.send.consolidateAutoResult_${outcome.status}`, {
        completed: outcome.completedRounds, remaining: outcome.eligibleUtxos ?? "?",
      }));
    } catch (e) {
      setConsolidationPreview(null);
      setConsolidationResultNote(t("wallet.send.consolidateAutoStopped"));
      setConsolidationError(e instanceof AmbiguousConsolidationBroadcastError
        ? e.message : safeError(e, t("wallet.send.consolidateFailed")));
    } finally {
      autoRunningRef.current = false;
      autoStopRef.current = true;
      setConsolidationPhase("");
      setConsolidationBusy(false);
      consolidationLock.current = false;
    }
  };

  const pauseAutoConsolidation = () => {
    if (!autoRunningRef.current) return;
    autoStopRef.current = true;
    setAutoPauseRequested(true);
  };

  const handleSendAnother = () => {
    setTo("");
    setAmount("");
    setPreview(null);
    setBroadcastTxid(null);
    setError(null);
    setAttemptedSend(false);
    setPhase("idle");
  };

  return (
    <AppLayout>
      <PageCard title={t("wallet.send.title")}>
        {!fromAddress ? (
          <div className="card">
            <p className="error">{t("wallet.send.createOrImportBeforeSending")}</p>
            <Link className="btn" to="/" style={{ textDecoration: "none" }}>{t("history.goReceive")}</Link>
          </div>
        ) : (
          <>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div className="section-title">{t("wallet.send.title")}</div>
                <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                  {t("wallet.send.verifyWarn")}
                </p>
              </div>

              <div>
                <label className="field-label">{t("wallet.send.fromLabel")}</label>
                <code style={{ display: "block", wordBreak: "break-all", overflowWrap: "anywhere" }}>{fromAddress}</code>
                <div className="muted" style={{ marginTop: 8 }}>
                  {balanceLoading ? t("wallet.send.loadingBalance") : balance ? `${t("wallet.send.confirmedBalance")}: ${balance.confirmed_pepew} PEPEW` : balanceError || t("wallet.balance.empty")}
                </div>
                {spentOutpoints.size > 0 && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Avoiding {spentOutpoints.size} recently spent UTXO{spentOutpoints.size === 1 ? "" : "s"} while the API/indexer updates.
                  </div>
                )}
              </div>

              <div>
                <label className="field-label">{t("wallet.send.toLabel")}</label>
                <input
                  className="input"
                  placeholder={t("wallet.send.recipientPlaceholder")}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={busy}
                />
                {recentRecipients.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="muted" style={{ marginBottom: 6 }}>{t("wallet.send.recentRecipients")}</div>
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
              </div>

              <div className="grid two">
                <div>
                  <label className="field-label">{t("wallet.send.amountLabel")}</label>
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
                  <label className="field-label">{t("wallet.send.feeLabel")}</label>
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

              <label className="row">
                <input
                  type="checkbox"
                  checked={subtractFee}
                  onChange={(e) => setSubtractFee(e.target.checked)}
                  disabled={busy}
                />
                <span>{t("wallet.send.subtractFee")}</span>
              </label>

              {displayValidationError && <p className="error" style={{ margin: 0 }}>{displayValidationError}</p>}
              {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
              {phase !== "idle" && phase !== "broadcasted" && (
                <p className="muted" style={{ margin: 0 }}>Status: {phase.replace(/_/g, " ")}</p>
              )}

              {preview && !broadcastTxid && phase !== "broadcasting" && (
                <div className="card" style={{ boxShadow: "none", border: "1px dashed var(--border)", marginBottom: 0 }}>
                  <div className="section-title">Transaction preview</div>
                  <div className="muted" style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    <div>Inputs: {preview.selectedInputCount}{preview.selectedUnconfirmedCount ? ` (${preview.selectedUnconfirmedCount} unconfirmed change)` : ""}</div>
                    <div>Recipient receives: {formatAtomicAsPepew(preview.recipientAmountAtomic)} PEPEW</div>
                    <div>Network fee: {formatAtomicAsPepew(preview.feeAtomic)} PEPEW</div>
                    <div>Change: {formatAtomicAsPepew(preview.changeAtomic)} PEPEW</div>
                  </div>
                </div>
              )}

              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn"
                  onClick={handlePrimarySend}
                  disabled={busy}
                >
                  {phase === "broadcasting" ? "Broadcasting..." : "Send PEPEW"}
                </button>
                <button className="btn secondary" type="button" onClick={refreshUtxoState} disabled={busy}>
                  {t("wallet.send.refreshUtxos")}
                </button>
                <button className="btn secondary" type="button" disabled={busy} onClick={() => {
                  setConsolidationOpen((value) => !value);
                  setConsolidationPreview(null);
                  setConsolidationError(null);
                }}>{t("wallet.send.advancedConsolidate")}</button>
                {broadcastTxid && (
                  <button className="btn secondary" type="button" onClick={handleSendAnother} disabled={busy}>
                    Clear for next send
                  </button>
                )}
              </div>
            </div>

            {consolidationOpen && (
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="section-title">{t("wallet.send.advancedConsolidate")}</div>
                <p className="muted" style={{ margin: 0 }}>
                  {t("wallet.send.consolidateDescription")}
                </p>
                <div>
                  <label className="field-label" htmlFor="consolidation-cap">{t("wallet.send.consolidateBatchSize")}</label>
                  <select id="consolidation-cap" className="input" value={consolidationCap} disabled={busy} onChange={(e) => {
                    setConsolidationCap(Number(e.target.value));
                    setConsolidationPreview(null);
                    setConsolidationError(null);
                  }}>
                    <option value={20}>20</option>
                    <option value={40}>40</option>
                    <option value={80}>80</option>
                  </select>
                </div>
                <div className="note">
                  <div className="field-label">{t("wallet.send.consolidateModeTitle")}</div>
                  <label className="row">
                    <input type="radio" name="consolidation-mode" value="manual"
                      checked={consolidationMode === "manual"} disabled={busy}
                      onChange={() => { setConsolidationMode("manual"); setConsolidationPreview(null); setAutoProgress(null); }} />
                    <span>{t("wallet.send.consolidateModeManual")}</span>
                  </label>
                  <label className="row">
                    <input type="radio" name="consolidation-mode" value="auto"
                      checked={consolidationMode === "auto"} disabled={busy}
                      onChange={() => { setConsolidationMode("auto"); setConsolidationPreview(null); setAutoProgress(null); }} />
                    <span>{t("wallet.send.consolidateModeAuto")}</span>
                  </label>
                  {consolidationMode === "auto" && (
                    <p className="muted" style={{ margin: 0 }}>{t("wallet.send.consolidateAutoWarning")}</p>
                  )}
                </div>
                {autoProgress && (
                  <div className="note" role="status" aria-live="polite">
                    <strong>{t("wallet.send.consolidateAutoProgress", {
                      completed: autoProgress.completedRounds, max: autoProgress.maxRounds,
                    })}</strong>
                    <div>{t(`wallet.send.consolidateAutoPhase_${autoProgress.phase}`)}</div>
                    {autoProgress.eligibleUtxos !== undefined && (
                      <div>{t("wallet.send.consolidateAutoRemaining", { count: autoProgress.eligibleUtxos })}</div>
                    )}
                    {autoProgress.lastTxid && (
                      <div>TxID: <code style={{ overflowWrap: "anywhere" }}>{autoProgress.lastTxid}</code></div>
                    )}
                    {autoPauseRequested && <div>{t("wallet.send.consolidatePausePending")}</div>}
                    {autoRunningRef.current && (
                      <button className="btn secondary" type="button" disabled={autoPauseRequested} onClick={pauseAutoConsolidation}>
                        {t("wallet.send.consolidatePause")}
                      </button>
                    )}
                  </div>
                )}
                {consolidationResultNote && <p className="muted" role="status">{consolidationResultNote}</p>}
                {!consolidationPreview && !consolidationTxid && (
                  <button className="btn secondary" type="button" disabled={busy || !mnemonic} onClick={prepareConsolidation}>
                    {t("wallet.send.consolidatePreviewAction")}
                  </button>
                )}
                {consolidationPhase && <p className="muted" role="status" style={{ margin: 0 }}>{consolidationPhase}</p>}
                {consolidationError && <p className="error" role="alert" style={{ margin: 0 }}>{consolidationError}</p>}
                {consolidationPreview && (
                  <div className="card warning-banner" style={{ margin: 0 }}>
                    <div className="section-title">{t("wallet.send.consolidateConfirmHeading")}</div>
                    <div className="note" style={{ marginTop: 8 }}>
                      <div>{t("wallet.send.consolidateInputs", { selected: consolidationPreview.selected.length, eligible: consolidationPreview.totalCandidates })}</div>
                      <div>{t("wallet.send.feeLabel")}: {formatAtomicAsPepew(consolidationPreview.feeAtomic)} PEPEW</div>
                      {autoEstimate && (
                        <div>{t("wallet.send.consolidateAutoBudget", {
                          rounds: autoEstimate.rounds,
                          fee: formatAtomicAsPepew(autoEstimate.estimatedTotalFeeAtomic),
                        })}</div>
                      )}
                    </div>
                    <div className="row">
                      <button className="btn" type="button" disabled={busy}
                        onClick={consolidationMode === "auto" ? startAutoConsolidation : confirmConsolidation}>
                        {t(consolidationMode === "auto" ? "wallet.send.consolidateStartAuto" : "wallet.send.consolidateConfirmAction")}
                      </button>
                      <button className="btn secondary" type="button" disabled={busy} onClick={() => setConsolidationPreview(null)}>
                        {t("wallet.send.consolidateCancelAction")}
                      </button>
                    </div>
                  </div>
                )}
                {consolidationMode === "auto" && consolidationTxid && !busy && !consolidationPreview && (
                  <button className="btn secondary" type="button" onClick={() => {
                    setConsolidationTxid(null);
                    setAutoProgress(null);
                    setConsolidationResultNote("");
                    void refreshUtxoState();
                  }}>{t("wallet.send.refreshUtxos")}</button>
                )}
                {consolidationTxid && consolidationMode === "manual" && (
                  <div className="note" role="status">
                    <strong>{t("wallet.send.consolidateSubmitted")}</strong>
                    <div>TxID: <code style={{ overflowWrap: "anywhere" }}>{consolidationTxid}</code></div>
                    <div>{t("wallet.send.consolidateWait")}</div>
                    <button className="btn secondary" type="button" disabled={busy} onClick={() => {
                      setConsolidationTxid(null);
                      void refreshUtxoState();
                    }}>{t("wallet.send.consolidateNextBatch")}</button>
                  </div>
                )}
              </div>
            )}

            {broadcastTxid && (
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="section-title">✅ Broadcast submitted</div>
                <p className="success" style={{ margin: 0 }}>Transaction was submitted to PEPEW Light API.</p>
                <div>
                  <span className="muted">TxID: </span>
                  <code style={{ display: "inline-block", maxWidth: "100%", wordBreak: "break-all", overflowWrap: "anywhere", lineHeight: 1.4 }}>
                    {broadcastTxid}
                  </code>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Link className="btn secondary" to="/history" style={{ textDecoration: "none" }}>View history</Link>
                  <button className="btn secondary" type="button" onClick={handleSendAnother} disabled={busy}>Clear for next send</button>
                </div>
              </div>
            )}
          </>
        )}
      </PageCard>
    </AppLayout>
  );
}
