const DEFAULT_TIMEOUT_MS = 8000;

const ADDRESS_ERROR_MESSAGE = "Invalid PEPEW address. Please check the address format and try again.";
const API_UNAVAILABLE_MESSAGE = "PEPEW Light API is temporarily unavailable. Please try again later.";
const RATE_LIMIT_MESSAGE = "Too many requests. Please wait a moment and try again.";
const TIMEOUT_MESSAGE = "Balance lookup timed out. Please try again.";

export interface LightAddressBalance {
  confirmed: number;
  unconfirmed: number;
  confirmed_pepew: string;
  unconfirmed_pepew: string;
}

export interface LightAddressResponse {
  address: string;
  balance: LightAddressBalance;
  history: { txid: string; height: number }[];
  source: string;
  read_only: boolean;
}

export interface LightHistoryResponse {
  address: string;
  history: { txid: string; height: number }[];
  mempool: { txid: string; height: number }[];
  source: string;
  read_only: boolean;
}

export interface LightUtxo {
  txid: string;
  vout: number;
  height: number;
  value: number;
}

export interface LightUtxoResponse {
  address: string;
  utxos: LightUtxo[];
  utxo_count: number;
  total: number;
  source: string;
  read_only: boolean;
}

export interface LightTxResponse {
  txid: string;
  data: any;
  source: string;
  read_only: boolean;
  raw?: boolean;
}

export interface LightBroadcastResponse {
  ok: boolean;
  txid?: string | null;
  source: string;
  signed_raw_tx_only: boolean;
}

function normalizeLightApiBase(value?: string) {
  const base = (value || "").trim().replace(/\/+$/, "");
  // Production wallet must use same-origin PEPEW Light / ElectrumX Gateway by default.
  // Ignore old or local development bases if they accidentally remain in build env.
  if (/^https?:\/\/api\.pepepow\.net$/i.test(base)) return "";
  if (/^http:\/\/localhost:8088$/i.test(base)) return "";
  if (/^http:\/\/127\.0\.0\.1:8088$/i.test(base)) return "";
  return base;
}

function withCacheBuster(path: string) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}_=${Date.now()}`;
}

function getRawErrorMessage(errJson: any) {
  const error = errJson?.error;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (typeof error?.code === "string") return error.code;
  if (typeof errJson?.detail === "string") return errJson.detail;
  if (typeof errJson?.message === "string") return errJson.message;
  return "";
}

function mapLightApiError(raw: string, status?: number) {
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
  if (text.includes("broadcast_rejected") || text.includes("missing inputs") || text.includes("txn-mempool-conflict")) {
    return "Transaction was rejected. The wallet may still be seeing stale UTXOs from a recent send; wait for the previous send to appear in history, then try again.";
  }
  if (text.includes("invalid_raw_tx") || text.includes("raw_tx_too")) {
    return "Signed transaction is invalid.";
  }
  if (status === 429 || text.includes("too many requests") || text.includes("rate limit")) {
    return RATE_LIMIT_MESSAGE;
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) {
    return TIMEOUT_MESSAGE;
  }
  if (status && status >= 500) {
    return API_UNAVAILABLE_MESSAGE;
  }
  if (text.includes("network") || text.includes("failed to fetch") || text.includes("temporarily unavailable")) {
    return API_UNAVAILABLE_MESSAGE;
  }
  return raw || API_UNAVAILABLE_MESSAGE;
}

export class PepewLightApiClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    // Production default is same-origin PEPEW Light API, e.g. https://light.pepepow.net/api/...
    const viteEnv = typeof import.meta !== "undefined" && (import.meta as any).env
      ? (import.meta as any).env.VITE_PEPEW_LIGHT_API_BASE_URL
      : undefined;
    this.baseUrl = normalizeLightApiBase(baseUrl ?? viteEnv);
    this.timeoutMs = timeoutMs;
  }


  private async fetchWithTimeout(path: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const base = this.baseUrl.replace(/\/+$/, "");
      const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
      const res = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: {
          "Cache-Control": "no-cache",
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        throw new Error(TIMEOUT_MESSAGE);
      }
      throw new Error(mapLightApiError(err?.message || "network error"));
    }
  }

  private async readError(res: Response) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = getRawErrorMessage(errJson);
    } catch {
      // ignore
    }
    return mapLightApiError(detail || `HTTP ${res.status}`, res.status);
  }

  async getAddress(address: string): Promise<LightAddressResponse> {
    if (!address) {
      throw new Error("Address is required");
    }
    const res = await this.fetchWithTimeout(withCacheBuster(`/api/wallet/address/${address}`));
    if (!res.ok) {
      throw new Error(await this.readError(res));
    }
    return res.json();
  }

  async getHistory(address: string): Promise<LightHistoryResponse> {
    if (!address) {
      throw new Error("Address is required");
    }
    const res = await this.fetchWithTimeout(withCacheBuster(`/api/wallet/history/${address}`));
    if (!res.ok) {
      throw new Error(await this.readError(res));
    }
    return res.json();
  }

  async getUtxo(address: string): Promise<LightUtxoResponse> {
    if (!address) {
      throw new Error("Address is required");
    }
    const res = await this.fetchWithTimeout(withCacheBuster(`/api/wallet/utxo/${address}`));
    if (!res.ok) {
      throw new Error(await this.readError(res));
    }
    return res.json();
  }

  async getTx(txid: string, raw = false): Promise<LightTxResponse> {
    if (!txid) {
      throw new Error("Txid is required");
    }
    const res = await this.fetchWithTimeout(withCacheBuster(`/api/wallet/tx/${txid}${raw ? "?raw=1" : ""}`));
    if (!res.ok) {
      throw new Error(await this.readError(res));
    }
    return res.json();
  }

  async broadcastSignedRawTx(rawTx: string): Promise<LightBroadcastResponse> {
    if (!rawTx) {
      throw new Error("Signed raw transaction is required");
    }
    const res = await this.fetchWithTimeout(`/api/wallet/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_tx: rawTx }),
    });
    if (!res.ok) {
      throw new Error(await this.readError(res));
    }
    return res.json();
  }
}

export const pepewLightClient = new PepewLightApiClient();