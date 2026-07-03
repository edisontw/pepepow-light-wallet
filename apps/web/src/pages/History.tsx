import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EXPLORER_BASE_URL } from "../lib/api";
import { pepewLightClient } from "../lib/pepewLightClient";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";

const INITIAL_HISTORY_LIMIT = 10;
const SHOW_MORE_STEP = 25;
const HISTORY_FETCH_THROTTLE_MS = 15000;

type FetchHealth = {
  status: "idle" | "ok" | "fail";
  statusCode: number | null;
  latencyMs: number | null;
};

type HistoryFetchSuccess = {
  ok: true;
  status: number;
  latencyMs: number;
  payload: any;
};

type HistoryFetchFailure = {
  ok: false;
  status: number | null;
  latencyMs: number;
  error: string;
};

type HistoryFetchResult = HistoryFetchSuccess | HistoryFetchFailure;

type CachedHistory = {
  ts: number;
  result: HistoryFetchResult;
};

type TxSummaryViewModel = {
  key: string;
  txid: string;
  timeLabel: string;
  statusLabel: string;
  heightLabel: string;
};

type TxDetailState = {
  txid: string;
  loading: boolean;
  error: string | null;
  data: any | null;
};

function txidOf(tx: any): string {
  return String(tx?.txid ?? tx?.tx_hash ?? tx?.hash ?? tx?.id ?? "");
}

function heightOf(tx: any): number {
  const raw = tx?.height ?? tx?.block_height ?? tx?.blockHeight ?? tx?.blockheight ?? tx?.confirmed_height ?? 0;
  const height = Number(raw);
  return Number.isFinite(height) ? height : 0;
}

function normalizeHistoryTx(tx: any) {
  return {
    ...tx,
    txid: txidOf(tx),
    height: heightOf(tx),
    time: tx?.time ?? tx?.blocktime ?? tx?.timestamp ?? tx?.ts ?? tx?.date ?? null,
  };
}

function parseHistoryPayload(payload: any) {
  if (Array.isArray(payload)) return { txs: payload.map(normalizeHistoryTx), source: "PEPEW Light API" };
  if (payload && typeof payload === "object") {
    let txs = Array.isArray(payload.txs)
      ? payload.txs
      : Array.isArray(payload.transactions)
        ? payload.transactions
        : [];
    if (!txs.length && (Array.isArray(payload.history) || Array.isArray(payload.mempool))) {
      const mempool = Array.isArray(payload.mempool) ? payload.mempool : [];
      const history = Array.isArray(payload.history) ? payload.history : [];
      txs = [...mempool, ...history];
    }
    return { ...payload, txs: txs.map(normalizeHistoryTx), source: payload.source || "PEPEW Light API" };
  }
  return { txs: [], source: "PEPEW Light API" };
}

function createHistoryKey(address: string) {
  return address;
}

function parseTxTimestampMs(tx: any): number | null {
  const raw = tx?.time ?? tx?.blocktime ?? tx?.timestamp ?? tx?.ts ?? tx?.date;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1e12) return Math.round(raw);
    if (raw > 1e9) return Math.round(raw * 1000);
    return null;
  }
  if (typeof raw === "string" && raw.trim()) {
    if (/^\d+$/.test(raw.trim())) {
      const asNum = Number(raw.trim());
      if (Number.isFinite(asNum)) {
        if (asNum > 1e12) return Math.round(asNum);
        if (asNum > 1e9) return Math.round(asNum * 1000);
      }
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatTimeLabel(tx: any): string {
  const tsMs = parseTxTimestampMs(tx);
  if (tsMs === null) return "Time unavailable";
  try {
    return new Date(tsMs).toLocaleString();
  } catch {
    return "Time unavailable";
  }
}

function shortTxid(txid: string): string {
  const value = String(txid || "");
  if (!value) return "--";
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatHeightLabel(tx: any, t?: any): string {
  const height = heightOf(tx);
  if (height <= 0) return t ? t("wallet.history.unconfirmed") : "mempool";
  return String(height);
}

function formatStatusLabel(tx: any, t: any): string {
  const height = heightOf(tx);
  const confirmations = Number(tx?.confirmations ?? tx?.confirmation_count ?? tx?.confirmed ?? NaN);
  if (Number.isFinite(confirmations) && confirmations > 0) {
    return `${t("wallet.history.confirmed")} · ${confirmations} ${t("history.confirmations")}`;
  }
  if (height > 0) return t("wallet.history.confirmed");
  return t("wallet.history.unconfirmed");
}

function extractTxData(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  return payload.data ?? payload.tx ?? payload.raw ?? payload;
}

function summarizeTxDetail(payload: any) {
  const txData = extractTxData(payload);
  if (typeof txData === "string") {
    const compact = txData.trim();
    return {
      type: "raw hex",
      size: compact.length ? `${compact.length} hex chars` : "--",
      time: "Time unavailable",
      confirmations: "--",
      preview: compact.length > 360 ? `${compact.slice(0, 360)}…` : compact || "--",
    };
  }
  if (txData && typeof txData === "object") {
    const inputCount = Array.isArray(txData.vin) ? txData.vin.length : Array.isArray(txData.inputs) ? txData.inputs.length : null;
    const outputCount = Array.isArray(txData.vout) ? txData.vout.length : Array.isArray(txData.outputs) ? txData.outputs.length : null;
    return {
      type: "decoded object",
      size: inputCount !== null || outputCount !== null ? `${inputCount ?? "?"} inputs / ${outputCount ?? "?"} outputs` : "object",
      time: formatTimeLabel(txData),
      confirmations: txData.confirmations ?? txData.confirmed ?? "--",
      preview: JSON.stringify(txData, null, 2).slice(0, 1800),
    };
  }
  return { type: typeof txData, size: "--", time: "Time unavailable", confirmations: "--", preview: String(txData ?? "--") };
}

export default function History() {
  const { t } = useTranslation();
  const [currentAddress] = useState(localStorage.getItem("pepew_address") || "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_HISTORY_LIMIT);
  const [reloadKey, setReloadKey] = useState(0);
  const [copiedTxid, setCopiedTxid] = useState<string | null>(null);
  const [txDetail, setTxDetail] = useState<TxDetailState | null>(null);
  const [health, setHealth] = useState<FetchHealth>({ status: "idle", statusCode: null, latencyMs: null });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const historyCacheRef = useRef<Map<string, CachedHistory>>(new Map());
  const historyInflightRef = useRef<Map<string, Promise<HistoryFetchResult>>>(new Map());
  const txDetailCacheRef = useRef<Map<string, any>>(new Map());
  const forceNextFetchRef = useRef(false);

  const fetchHistory = async (address: string, force = false): Promise<HistoryFetchResult> => {
    const key = createHistoryKey(address);
    const now = Date.now();
    const inFlight = historyInflightRef.current.get(key);
    if (inFlight) return inFlight;

    const cached = historyCacheRef.current.get(key);
    if (!force && cached && now - cached.ts < HISTORY_FETCH_THROTTLE_MS) return cached.result;

    const promise = (async (): Promise<HistoryFetchResult> => {
      const startedAt = Date.now();
      try {
        const payload = await pepewLightClient.getHistory(address);
        const latencyMs = Date.now() - startedAt;
        return { ok: true, status: 200, latencyMs, payload: parseHistoryPayload(payload) };
      } catch (e: any) {
        return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: e?.message || t("errors.apiUnreachable") };
      }
    })();

    historyInflightRef.current.set(key, promise);
    try {
      const result = await promise;
      historyCacheRef.current.set(key, { ts: Date.now(), result });
      return result;
    } finally {
      historyInflightRef.current.delete(key);
    }
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!currentAddress) return;
      setLoading(true);
      setErr(null);
      const force = forceNextFetchRef.current;
      forceNextFetchRef.current = false;

      try {
        const result = await fetchHistory(currentAddress, force);
        if (!active) return;
        if (!result.ok) {
          setErr(result.error || t("history.readFailed"));
          setHealth({ status: "fail", statusCode: result.status, latencyMs: result.latencyMs });
          return;
        }
        setData(result.payload);
        setHealth({ status: "ok", statusCode: result.status, latencyMs: result.latencyMs });
        setLastUpdatedAt(Date.now());
      } catch (e: any) {
        if (!active) return;
        setErr(e?.message || t("errors.apiUnreachable"));
        setHealth((prev) => ({ ...prev, status: "fail" }));
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [currentAddress, reloadKey, t]);

  const allTxs = useMemo(() => (Array.isArray(data?.txs) ? data.txs : []), [data]);
  const txs = useMemo(() => allTxs.slice(0, visibleCount), [allTxs, visibleCount]);

  const txViewModels = useMemo<TxSummaryViewModel[]>(() => txs.map((tx: any, idx: number) => {
    const txid = txidOf(tx);
    return {
      key: txid || `tx-${idx}`,
      txid,
      timeLabel: formatTimeLabel(tx),
      statusLabel: formatStatusLabel(tx, t),
      heightLabel: formatHeightLabel(tx, t),
    };
  }), [txs, t]);

  const lastUpdatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "--";
  const apiHealthLabel = health.status === "ok"
    ? `${t("history.debug.apiHealthOk")} (${health.latencyMs ?? "--"} ms)`
    : health.status === "fail"
      ? `${t("history.debug.apiHealthFail")} (${health.latencyMs ?? "--"} ms)`
      : t("history.debug.apiHealthIdle");

  const copyTxid = async (txid: string) => {
    if (!txid) return;
    try {
      await navigator.clipboard.writeText(txid);
      setCopiedTxid(txid);
      setTimeout(() => setCopiedTxid(null), 1400);
    } catch {
      setCopiedTxid(null);
    }
  };

  const openTxDetail = async (txid: string) => {
    if (!txid) return;
    if (txDetail?.txid === txid && !txDetail.loading) {
      setTxDetail(null);
      return;
    }
    const cached = txDetailCacheRef.current.get(txid);
    if (cached) {
      setTxDetail({ txid, loading: false, error: null, data: cached });
      return;
    }

    setTxDetail({ txid, loading: true, error: null, data: null });
    try {
      const payload = await pepewLightClient.getTx(txid);
      txDetailCacheRef.current.set(txid, payload);
      setTxDetail({ txid, loading: false, error: null, data: payload });
    } catch (e: any) {
      setTxDetail({ txid, loading: false, error: e?.message || "Transaction detail lookup failed.", data: null });
    }
  };

  const handleRefresh = () => {
    setTxDetail(null);
    forceNextFetchRef.current = true;
    setReloadKey((v) => v + 1);
  };

  const activeDetailSummary = txDetail?.data ? summarizeTxDetail(txDetail.data) : null;

  return (
    <AppLayout>
      <PageCard title={t("history.title")}>
        {!currentAddress ? (
          <div className="card"><p>{t("history.emptyAddress")}</p></div>
        ) : err ? (
          <div className="card">
            <p className="error">{t("history.readFailed")}: {err}</p>
            <button className="btn secondary" onClick={handleRefresh}>{t("history.refresh")}</button>
          </div>
        ) : data ? (
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div className="section-title">{t("history.title")}</div>
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
                  {t("wallet.history.sourceInfo", { showing: txs.length, total: allTxs.length })}
                </div>
              </div>
              <button className="btn secondary" onClick={handleRefresh} disabled={loading}>{loading ? t("loading") : t("history.refresh")}</button>
            </div>

            {data?.error && <div className="muted" style={{ marginBottom: 8 }}>{data.error}</div>}
            {!txs.length ? (
              <div>
                <p>{loading ? t("history.loading") : t("history.emptyTxs")}</p>
                <div className="row"><Link className="btn" to="/">{t("history.goReceive")}</Link></div>
              </div>
            ) : (
              <>
                <div className="tx-list">
                  {txViewModels.map((tx) => {
                    const isActiveDetail = txDetail?.txid === tx.txid;
                    const detailSummary = isActiveDetail ? activeDetailSummary : null;
                    return (
                      <div key={tx.key}>
                        <div className="tx-row">
                          <div className="tx-info">
                            <div className="tx-line">
                              <span className="muted">Status: </span>
                              <strong>{tx.statusLabel}</strong>
                              <span className="muted" style={{ marginLeft: 8 }}>Height: </span>
                              <span>{tx.heightLabel}</span>
                            </div>
                            <div className="tx-line"><span className="muted">{t("history.timeLabel")}: </span><span>{tx.timeLabel}</span></div>
                            <div className="tx-line">
                              <span className="muted">{t("history.txidLabel")}: </span>
                              <a href={`/tx?txid=${tx.txid}`} target="_blank" rel="noopener noreferrer" title={tx.txid} style={{ color: "var(--primary-color)", textDecoration: "underline" }}>
                                <code>{shortTxid(tx.txid)}</code>
                              </a>
                            </div>
                          </div>

                          <div className="tx-actions">
                            <button className="btn ghost small" onClick={() => openTxDetail(tx.txid)} disabled={!tx.txid || txDetail?.loading}>
                              {isActiveDetail ? (txDetail?.loading ? t("loading") : t("hide")) : t("wallet.history.openTx")}
                            </button>
                            <button className="btn ghost small" onClick={() => copyTxid(tx.txid)} disabled={!tx.txid}>{copiedTxid === tx.txid ? t("copied") : t("copy")}</button>
                            {tx.txid && (
                              <a href={`${EXPLORER_BASE_URL}/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer" className="btn ghost small" title={t("viewInExplorer")}>
                                {t("viewInExplorer")}
                              </a>
                            )}
                          </div>
                        </div>

                        {isActiveDetail && (
                          <div className="card" style={{ marginTop: 8, marginBottom: 8 }}>
                            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                              <div>
                                <div className="section-title">{t("history.detailTitle")}</div>
                                <div className="muted" style={{ wordBreak: "break-all", marginTop: 2 }}>{tx.txid}</div>
                              </div>
                              <button className="btn ghost small" onClick={() => setTxDetail(null)}>{t("history.detailClose")}</button>
                            </div>
                            {txDetail.loading ? (
                              <p className="muted">{t("history.detailLoading")}</p>
                            ) : txDetail.error ? (
                              <p className="error">{txDetail.error}</p>
                            ) : detailSummary ? (
                              <div>
                                <div className="row" style={{ gap: 18, marginBottom: 8 }}>
                                  <div><span className="muted">{t("history.detailDirectionLabel")}: </span><strong>{detailSummary.type}</strong></div>
                                  <div><span className="muted">{t("history.sizeLabel", "Size")}: </span><strong>{detailSummary.size}</strong></div>
                                  <div><span className="muted">{t("history.timeLabel")}: </span><strong>{detailSummary.time}</strong></div>
                                  <div><span className="muted">{t("history.confirmations")}: </span><strong>{detailSummary.confirmations}</strong></div>
                                </div>
                                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 360, overflow: "auto" }}>{detailSummary.preview}</pre>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {visibleCount < allTxs.length && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn secondary" onClick={() => setVisibleCount((v) => Math.min(v + SHOW_MORE_STEP, allTxs.length))}>{t("history.showMore")}</button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="card"><p>{t("history.loading")}</p></div>
        )}

        {currentAddress && (
          <details className="details">
            <summary>{t("history.debugTitle")}</summary>
            <div style={{ marginTop: 8 }}><strong>{t("history.debug.summaryTitle")}</strong></div>
            <div>{t("history.debug.lastUpdatedAt")}: <strong>{lastUpdatedLabel}</strong></div>
            <div>{t("history.debug.apiHealth")}: <strong>{apiHealthLabel}</strong></div>
            {health.statusCode !== null && <div>{t("history.debug.status")}: <code>{health.statusCode}</code></div>}
          </details>
        )}
      </PageCard>
    </AppLayout>
  );
}
