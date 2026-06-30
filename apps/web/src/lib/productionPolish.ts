const WALLET_PATH_PREFIX = "/wallet";
const NOTICE_ID = "pepew-wallet-safety-notice";

const ADDRESS_ERROR_MESSAGE = "Invalid PEPEW address. Please check the address format and try again.\nPEPEW 地址格式不正確，請確認後再試。";

function isWalletHomePage() {
  return window.location.pathname === WALLET_PATH_PREFIX || window.location.pathname === `${WALLET_PATH_PREFIX}/`;
}

function appendTextLine(parent: HTMLElement, text: string, style?: Partial<CSSStyleDeclaration>) {
  const div = document.createElement("div");
  div.textContent = text;
  if (style) Object.assign(div.style, style);
  parent.appendChild(div);
  return div;
}

function injectSafetyNotice() {
  if (!isWalletHomePage() || document.getElementById(NOTICE_ID)) return;
  const body = document.querySelector(".page-card-body");
  if (!body) return;

  const notice = document.createElement("div");
  notice.id = NOTICE_ID;
  notice.className = "card";
  notice.setAttribute("role", "note");
  notice.style.border = "1px solid rgba(255, 170, 0, 0.45)";
  notice.style.marginBottom = "12px";

  appendTextLine(notice, "Non-custodial wallet / 非託管網頁錢包").className = "section-title";

  const content = document.createElement("div");
  content.className = "muted";
  content.style.marginTop = "6px";
  content.style.lineHeight = "1.55";
  appendTextLine(content, "Your mnemonic and private keys stay in your browser.");
  appendTextLine(content, "PEPEW Light API only receives addresses for balance and history lookup.");
  appendTextLine(content, "Never share or screenshot your mnemonic.");
  appendTextLine(content, "助記詞與私鑰只會保存在你的瀏覽器本機。", { marginTop: "6px" });
  appendTextLine(content, "PEPEW Light API 只會接收地址，用於查詢餘額與交易紀錄。");
  appendTextLine(content, "請勿分享或截圖助記詞。");
  notice.appendChild(content);

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
    el.replaceChildren();
    appendTextLine(el, "Confirmed Balance", {
      fontSize: "0.8rem",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      opacity: "0.82",
    });
    appendTextLine(el, confirmed, {
      fontSize: "1.08rem",
      fontWeight: "700",
      color: "inherit",
    });
    appendTextLine(el, "Source: PEPEW Light API", {
      fontSize: "0.82rem",
      marginTop: "2px",
    });
    if (unconfirmed && !unconfirmed.startsWith("0")) {
      appendTextLine(el, `Unconfirmed: ${unconfirmed} PEPEW`, {
        fontSize: "0.86rem",
        marginTop: "2px",
      });
    }
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
