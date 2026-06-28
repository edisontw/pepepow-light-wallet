const DEFAULT_TIMEOUT_MS = 8000;

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

export interface LightTxResponse {
  txid: string;
  data: any;
  source: string;
  read_only: boolean;
}

export class PepewLightApiClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    // Configured from environment variable, falling back to localhost or a relative/default path
    const viteEnv = typeof import.meta !== "undefined" && (import.meta as any).env
      ? (import.meta as any).env.VITE_PEPEW_LIGHT_API_BASE_URL
      : undefined;
    this.baseUrl = baseUrl || viteEnv || "http://localhost:8088";
    this.timeoutMs = timeoutMs;
  }


  private async fetchWithTimeout(path: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const base = this.baseUrl.replace(/\/+$/, "");
      const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async getAddress(address: string): Promise<LightAddressResponse> {
    if (!address) {
      throw new Error("Address is required");
    }
    const res = await this.fetchWithTimeout(`/api/wallet/address/${address}`);
    if (!res.ok) {
      let detail = "";
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || errJson?.detail || "";
      } catch {
        // ignore
      }
      throw new Error(detail || `HTTP error: ${res.status}`);
    }
    return res.json();
  }

  async getHistory(address: string): Promise<LightHistoryResponse> {
    if (!address) {
      throw new Error("Address is required");
    }
    const res = await this.fetchWithTimeout(`/api/wallet/history/${address}`);
    if (!res.ok) {
      let detail = "";
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || errJson?.detail || "";
      } catch {
        // ignore
      }
      throw new Error(detail || `HTTP error: ${res.status}`);
    }
    return res.json();
  }

  async getTx(txid: string): Promise<LightTxResponse> {
    if (!txid) {
      throw new Error("Txid is required");
    }
    const res = await this.fetchWithTimeout(`/api/wallet/tx/${txid}`);
    if (!res.ok) {
      let detail = "";
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || errJson?.detail || "";
      } catch {
        // ignore
      }
      throw new Error(detail || `HTTP error: ${res.status}`);
    }
    return res.json();
  }
}

export const pepewLightClient = new PepewLightApiClient();
