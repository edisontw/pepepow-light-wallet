import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Buffer } from "buffer";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { deriveFromMnemonic, generateMnemonic, validateMnemonic, PEPEPOW, pubkeyToP2PKH } from "@pepepow/wallet-core";
import AppLayout from "../components/layout/AppLayout";
import PageCard from "../components/layout/PageCard";
import { pepewLightClient, LightAddressBalance } from "../lib/pepewLightClient";
import { fmtPEPEWFromSats } from "../lib/format";


type CopyStatus = "idle" | "copied" | "failed";

function normalizeMnemonicInput(value: string) {
  if (!value) return "";
  return value.normalize("NFKD").toLowerCase().replace(/\s+/g, " ").trim();
}

function formatAddressError(error: string | null) {
  if (!error) return null;
  if (/unsupported_address_prefix|invalid_address|bad_checksum|address_too_short|address_too_long/i.test(error)) {
    return "Invalid PEPEW address. Please check the address format and try again.";
  }
  return error;
}

export default function WalletHome() {
  const { t } = useTranslation();
  const [address, setAddress] = useState(localStorage.getItem("pepew_address") || "");
  const [mnemo, setMnemo] = useState(localStorage.getItem("pepew_mnemonic") || "");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [qr, setQr] = useState<string>("");
  const [lightBalance, setLightBalance] = useState<LightAddressBalance | null>(null);
  const [lightBalanceError, setLightBalanceError] = useState<string | null>(null);
  const [lightBalanceLoading, setLightBalanceLoading] = useState(false);
  const [understandRisk, setUnderstandRisk] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const defaultPath = "m/44'/5'/0'/0/0";

  const normalizedMnemonic = normalizeMnemonicInput(mnemo);
  const mnemonicWordCount = normalizedMnemonic ? normalizedMnemonic.split(" ").length : 0;
  const mnemonicValid = (mnemonicWordCount === 12 || mnemonicWordCount === 24)
    && validateMnemonic(normalizedMnemonic);
  const showMnemonicHint = mnemo.trim().length > 0 && !mnemonicValid;

  useEffect(() => {
    const trimmed = address.trim();
    if (!trimmed) {
      setQr("");
      setLightBalance(null);
      setLightBalanceError(null);
      return;
    }

    localStorage.setItem("pepew_address", trimmed);
    QRCode.toDataURL(`pepepow:${trimmed}`).then(setQr).catch(() => setQr(""));

    let active = true;
    const run = async () => {
      setLightBalanceLoading(true);
      setLightBalanceError(null);
      try {
        const data = await pepewLightClient.getAddress(trimmed);
        if (!active) return;
        setLightBalance(data.balance);
        setLastUpdated(new Date().toLocaleString());
      } catch (e: any) {
        if (!active) return;
        setLightBalance(null);
        setLightBalanceError(formatAddressError(e?.message || "PEPEW Light API lookup failed."));
      } finally {
        if (active) setLightBalanceLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [address]);

  const createWallet = async () => {
    setWalletError(null);
    try {
      const mnemonic = generateMnemonic();
      const node = await deriveFromMnemonic(mnemonic, defaultPath);
      const derived = pubkeyToP2PKH(Buffer.from(node.publicKey!), PEPEPOW);
      setMnemo(mnemonic);
      setAddress(derived);
      localStorage.setItem("pepew_mnemonic", mnemonic);
      localStorage.setItem("pepew_address", derived);
    } catch {
      setWalletError(t("home.walletCreateFailed"));
    }
  };

  const applyMnemonic = async () => {
    if (!normalizedMnemonic) {
      setWalletError(t("home.mnemonicMissing"));
      return;
    }
    if (!mnemonicValid) {
      setWalletError(t("home.mnemonicInvalid"));
      return;
    }
    setWalletError(null);
    try {
      const node = await deriveFromMnemonic(normalizedMnemonic, defaultPath);
      const derived = pubkeyToP2PKH(Buffer.from(node.publicKey!), PEPEPOW);
      setMnemo(normalizedMnemonic);
      setAddress(derived);
      localStorage.setItem("pepew_mnemonic", normalizedMnemonic);
      localStorage.setItem("pepew_address", derived);
    } catch {
      setWalletError(t("home.mnemonicInvalid"));
    }
  };

  const clearWallet = () => {
    if (window.confirm("Are you sure you want to clear the wallet from this browser? Make sure you have backed up your mnemonic phrase!")) {
      localStorage.removeItem("pepew_mnemonic");
      localStorage.removeItem("pepew_address");
      setMnemo("");
      setAddress("");
      setLightBalance(null);
      setWalletError(null);
      setUnderstandRisk(false);
    }
  };

  const copyMnemonic = async () => {
    if (!mnemo) return;
    try {
      await navigator.clipboard.writeText(mnemo);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    } finally {
      setTimeout(() => setCopyStatus("idle"), 1600);
    }
  };

  return (
    <AppLayout>
      <PageCard title={t("title")}>
        <div className="card" style={{ border: "1px solid rgba(0, 150, 255, 0.45)", marginBottom: 12 }}>
          <div className="section-title" style={{ color: "rgba(0, 150, 255, 1)" }}>Public Beta / 公開測試版</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.55, fontSize: "0.9rem" }}>
            <div style={{ fontWeight: "bold", marginBottom: 2 }}>English:</div>
            <div>Read-only wallet features are available. Sending/broadcasting will be added only after signed transaction flow is fully verified.</div>

            <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 2 }}>中文:</div>
            <div>目前以查詢餘額與交易紀錄為主。送出交易功能只會在 signed transaction 流程完整驗證後加入。</div>
          </div>
        </div>

        <div className="card" style={{ border: "1px solid rgba(255, 170, 0, 0.45)", marginBottom: 12 }}>
          <div className="section-title" style={{ color: "rgba(255, 170, 0, 1)" }}>Non-custodial Safety Warning / 安全提示</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.55, fontSize: "0.9rem" }}>
            <div style={{ fontWeight: "bold", marginBottom: 2 }}>English:</div>
            <div>Your mnemonic and private keys stay in your browser.</div>
            <div>The server never receives your mnemonic or private keys.</div>
            <div>Back up your recovery phrase before using the wallet.</div>

            <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 2 }}>中文:</div>
            <div>助記詞與私鑰只保存在你的瀏覽器中。</div>
            <div>伺服器不會接收你的助記詞或私鑰。</div>
            <div>使用前請自行備份 recovery phrase。</div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">{t("home.localWallet")}</div>
          
          <label className="row" style={{ marginTop: 10, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={understandRisk}
              onChange={(e) => setUnderstandRisk(e.target.checked)}
            />
            <span style={{ fontSize: "0.9rem", userSelect: "none" }}>
              I understand that my keys are stored only in this browser and I must back them up. / 我理解金鑰僅保存在此瀏覽器中，且我已自行備份。
            </span>
          </label>

          <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 8 }}>
            <button className="btn" onClick={createWallet} disabled={!understandRisk}>{t("home.createWallet")}</button>
            <button className="btn secondary" onClick={applyMnemonic} disabled={!mnemonicValid || !understandRisk}>{t("home.useMnemonic")}</button>
            <button className="btn ghost" onClick={() => setShowMnemonic((prev) => !prev)}>
              {showMnemonic ? t("hide") : t("show")}
            </button>
            <button className="btn secondary" onClick={copyMnemonic} disabled={!mnemo}>{t("copy")}</button>
            {mnemo && (
              <button className="btn" style={{ backgroundColor: "rgba(220, 50, 50, 1)", color: "white" }} onClick={clearWallet}>
                Forget Wallet / 清除錢包
              </button>
            )}
            {copyStatus === "copied" && <span className="muted">{t("copied")}</span>}
            {copyStatus === "failed" && <span className="error">{t("copyFailed")}</span>}
            {walletError && <span className="error">{walletError}</span>}
          </div>
          <textarea
            className="input"
            style={{ marginTop: 6, WebkitTextSecurity: showMnemonic ? "none" : "disc" } as CSSProperties}
            value={mnemo}
            onChange={(e) => setMnemo(e.target.value)}
            onBlur={() => {
              const normalized = normalizeMnemonicInput(mnemo);
              if (normalized && normalized !== mnemo) setMnemo(normalized);
            }}
            placeholder={t("home.mnemonicPlaceholder")}
          />
          {showMnemonicHint && (
            <div className="muted" style={{ marginTop: 6 }}>
              {t("home.mnemonicHint")}
            </div>
          )}
        </div>

        <div className="card">
          <label className="field-label">{t("address")}</label>
          <div className="row">
            <input
              className="input"
              placeholder="P..."
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
            />
            <button className="btn secondary" onClick={() => localStorage.setItem("pepew_address", address.trim())}>{t("home.save")}</button>
            <Link className="btn ghost" to="/history" style={{ textDecoration: "none" }}>{t("history.title")}</Link>
          </div>
        </div>

        {address && (
          <div className="grid two">
            <div className="card">
              <div className="section-title">Confirmed Balance</div>
              {lightBalanceLoading ? (
                <div className="muted" style={{ marginTop: 6 }}>Loading PEPEW Light API balance...</div>
              ) : lightBalance ? (
                <>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 6 }}>
                    {fmtPEPEWFromSats(lightBalance.confirmed, { decimals: 4 })}
                  </div>
                  {Number(lightBalance.unconfirmed) > 0 && (
                    <div className="muted" style={{ marginTop: 4, fontSize: "1rem" }}>
                      Unconfirmed: {fmtPEPEWFromSats(lightBalance.unconfirmed, { decimals: 4 })}
                    </div>
                  )}
                  <div className="muted" style={{ marginTop: 8, fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div>API Status: <span style={{ color: "rgba(0, 200, 100, 1)", fontWeight: "bold" }}>Healthy</span></div>
                    {lastUpdated && <div>Updated: {lastUpdated}</div>}
                    <div>Source: PEPEW Light API / ElectrumX Gateway</div>
                  </div>
                </>
              ) : (
                <div className="error" style={{ marginTop: 6 }}>
                  {lightBalanceError || "PEPEW Light API balance unavailable."}
                </div>
              )}
            </div>
            <div className="card">
              <div className="section-title">{t("receive")}</div>
              <code style={{ wordBreak: "break-all" }}>{address}</code>
              {qr && <div style={{ marginTop: 12 }}><img alt="qr" src={qr} className="qr" /></div>}
            </div>
          </div>
        )}
      </PageCard>
    </AppLayout>
  );
}
