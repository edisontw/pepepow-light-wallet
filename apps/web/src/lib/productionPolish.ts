const WALLET_PATH_PREFIX = "/wallet";
const NOTICE_ID = "pepew-wallet-safety-notice";

const ADDRESS_ERROR_MESSAGE = "Invalid PEPEW address. Please check the address format and try again.\nPEPEW 地址格式不正確，請確認後再試。";

function isWalletPage() {
  return window.location.pathname === WALLET_PATH_PREFIX || window.location.pathname.startsWith(`${WALLET_PATH_PREFIX}/`);
}

function injectSafetyNotice() {
  if (!isWalletPage() || document.getElementById(NOTICE_ID)) return;
  const body = document.querySelector(".page-card-body");
  if (!body) return;

  const notice = document.createElement("div");
  notice.id = NOTICE_ID;
  notice.className = "card";
  notice.setAttribute("role", "note");
  notice.style.border = "1px solid rgba(255, 170, 0, 0.45)";
  notice.style.marginBottom = "12px";
  notice.innerHTML = `
    <div class="section-title">Non-custodial wallet / 非託管網頁錢包</div>
    <div class="muted" style="margin-top:6px;line-height:1.55">
      <div>Your mnemonic and private keys stay in your browser.</div>
      <div>PEPEW Light API only receives addresses for balance and history lookup.</div>
      <div>Never share or screenshot your mnemonic.</div>
      <div style="margin-top:6px">助記詞與私鑰只會保存在你的瀏覽器本機。</div>
      <div>PEPEW Light API 只會接收地址，用於查詢餘額與交易紀錄。</div>
      <div>請勿分享或截圖助記詞。</div>
    </div>
  `;
  body.insertBefore(notice, body.firstChild);
}

function normalizeApiError(raw: string) {
  const text = raw.toLowerCase();
  if (
    text.includes("unsupported_address_prefix") ||
    text.includes("invalid_address") ||
    text.includes("bad_checksum") ||
    text.includes("address_too_short") ||
    text.includes("address_too_long") ||
    text.includes("invalid pepepow address") ||
    text.includes("invalid pepew address")
  ) {
    return ADDRESS_ERROR_MESSAGE;
  }
  if (text.includes("429") || text.includes("too many requests") || text.includes("rate limit")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) {
    return "Balance lookup timed out. Please try again.";
  }
  if (text.includes("network") || text.includes("failed to fetch") || text.includes("temporarily unavailable")) {
    return "PEPEW Light API is temporarily unavailable. Please try again later.";
  }
  return "PEPEW Light API is temporarily unavailable. Please try again later.";
}

function polishLightBalance() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".muted"))) {
    const text = el.textContent || "";
    if (!text.includes("Light API Balance:")) continue;
    if (el.dataset.pepewPolished === "balance") continue;

    const confirmed = el.querySelector("strong")?.textContent?.trim() || "—";
    const unconfirmedMatch = text.match(/\+([^()]+?)\s+unconfirmed/i);
    const unconfirmed = unconfirmedMatch?.[1]?.trim();

    el.dataset.pepewPolished = "balance";
    el.innerHTML = `
      <div style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em;opacity:0.82">Confirmed Balance</div>
      <div style="font-size:1.08rem;font-weight:700;color:inherit">${confirmed}</div>
      <div style="font-size:0.82rem;margin-top:2px">Source: PEPEW Light API</div>
      ${unconfirmed && !unconfirmed.startsWith("0") ? `<div style="font-size:0.86rem;margin-top:2px">Unconfirmed: ${unconfirmed} PEPEW</div>` : ""}
    `;
  }
}

function polishLightErrors() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".error"))) {
    const text = el.textContent || "";
    if (!text.includes("Light API Error:")) continue;
    if (el.dataset.pepewPolished === "error") continue;
    const raw = text.replace("Light API Error:", "").trim();
    el.dataset.pepewPolished = "error";
    el.textContent = normalizeApiError(raw);
  }
}

function runProductionPolish() {
  injectSafetyNotice();
  polishLightBalance();
  polishLightErrors();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", runProductionPolish);
  window.addEventListener("load", runProductionPolish);
  const observer = new MutationObserver(runProductionPolish);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export {};
