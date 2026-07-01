import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";
import { pepewLightClient, LightAddressBalance } from "../lib/pepewLightClient";

const MIN_SEND_AMOUNT = 0.00000001;

function normalizeAddressInput(value: string) {
  if (!value) return "";
  const trimmed = value.trim();
  const withoutScheme = trimmed
    .replace(/^(pepepow|pepew):\/\//i, "")
    .replace(/^(pepepow|pepew):/i, "");
  return (withoutScheme.split("?")[0] || "").trim();
}

function parsePositiveNumber(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatAddressError(error: string | null) {
  if (!error) return null;
  if (/unsupported_address_prefix|invalid_address|bad_checksum|address_too_short|address_too_long/i.test(error)) {
    return "Invalid PEPEW address.";
  }
  return error;
}

export default function Send() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [fromAddress] = useState(localStorage.getItem("pepew_address") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [amount, setAmount] = useState(searchParams.get("amount") || "");
  const [fee, setFee] = useState("0.0001");
  const [balance, setBalance] = useState<LightAddressBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const normalizedTo = useMemo(() => normalizeAddressInput(to), [to]);
  const amountNumber = useMemo(() => parsePositiveNumber(amount), [amount]);
  const feeNumber = useMemo(() => parsePositiveNumber(fee), [fee]);
  const confirmedNumber = useMemo(() => {
    const n = Number(balance?.confirmed_pepew ?? NaN);
    return Number.isFinite(n) ? n : null;
  }, [balance]);

  const validationError = useMemo(() => {
    if (!fromAddress) return "Create or import a wallet before sending.";
    if (!normalizedTo) return "Enter a recipient PEPEW address.";
    if (!amountNumber || amountNumber < MIN_SEND_AMOUNT) return "Enter a valid send amount.";
    if (!feeNumber) return "Enter a valid fee.";
    if (confirmedNumber !== null && amountNumber + feeNumber > confirmedNumber) {
      return "Amount plus fee is greater than the confirmed balance.";
    }
    return null;
  }, [fromAddress, normalizedTo, amountNumber, feeNumber, confirmedNumber]);

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

  return (
    <AppLayout>
      <PageCard title="Send PEPEW">
        <div className="card" style={{ border: "1px solid rgba(255, 170, 0, 0.45)", marginBottom: 12 }}>
          <div className="section-title">Send is in preview mode</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
            <div>Broadcast is not enabled yet.</div>
            <div>This page is only a safe send preview for the next non-custodial transaction flow.</div>
            <div>Private keys and signing must remain in the browser. The server may only receive a signed raw transaction in a later phase.</div>
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
                  />
                </div>
                <div>
                  <label className="field-label">Fee</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0.0001"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Review</div>
              <div style={{ marginTop: 8 }}><span className="muted">To: </span><code style={{ wordBreak: "break-all" }}>{normalizedTo || "--"}</code></div>
              <div style={{ marginTop: 8 }}><span className="muted">Amount: </span><strong>{amountNumber ? `${amountNumber} PEPEW` : "--"}</strong></div>
              <div style={{ marginTop: 8 }}><span className="muted">Fee: </span><strong>{feeNumber ? `${feeNumber} PEPEW` : "--"}</strong></div>
              {validationError && <p className="error" style={{ marginTop: 10 }}>{validationError}</p>}
              {!validationError && (
                <p className="muted" style={{ marginTop: 10 }}>
                  Inputs, signing, and broadcast are intentionally disabled until the signed-raw-transaction flow is reviewed.
                </p>
              )}
              <button className="btn" disabled style={{ marginTop: 10 }}>
                Broadcast disabled
              </button>
            </div>
          </>
        )}
      </PageCard>
    </AppLayout>
  );
}
