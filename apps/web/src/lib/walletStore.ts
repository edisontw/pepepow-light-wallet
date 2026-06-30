import { getPendingSpendTotal } from "./pending";
import { pepewLightClient } from "./pepewLightClient";

export interface Utxo {
    txid: string;
    vout: number;
    valueSats: number;
    scriptHex: string;
    confirmations?: number;
    invalid?: boolean;
}

export type WalletState = {
    address: string;
    utxos: Utxo[];
    utxoSumSats: number | null;
    pendingSpendSats: number;
    optimisticDeductionSats: number;
    lastUpdate: number;
    error: string | null;
    status: "idle" | "loading" | "ok" | "error";
    rawUtxoSumStatus: number | null;
    rawUtxoSumLastRequestUrl: string | null;
    rawUtxoSumError: string | null;
};

type Listener = (state: WalletState) => void;

class WalletStore {
    private state: WalletState = {
        address: localStorage.getItem("pepew_address") || "",
        utxos: [],
        utxoSumSats: null,
        pendingSpendSats: 0,
        optimisticDeductionSats: 0,
        lastUpdate: 0,
        error: null,
        status: "idle",
        rawUtxoSumStatus: null,
        rawUtxoSumLastRequestUrl: null,
        rawUtxoSumError: null,
    };

    private listeners: Set<Listener> = new Set();

    constructor() {
        this.updatePending();
        if (this.state.address) {
            setTimeout(() => this.fetch(), 0);
        }
    }

    getState() {
        return { ...this.state };
    }

    getDisplayBalance() {
        if (this.state.utxoSumSats === null) return null;
        return Math.max(this.state.utxoSumSats - this.state.optimisticDeductionSats, 0);
    }

    applyOptimistic(amountSats: number) {
        this.state.optimisticDeductionSats += amountSats;
        this.notify();
    }

    subscribe(l: Listener) {
        this.listeners.add(l);
        return () => { this.listeners.delete(l); };
    }

    private notify() {
        this.listeners.forEach((l) => l(this.getState()));
    }

    setAddress(addr: string) {
        if (this.state.address === addr) return;
        this.state.address = addr;
        this.state.utxos = [];
        this.state.utxoSumSats = null;
        this.updatePending();
        this.notify();
        if (addr) this.fetch();
    }

    updatePending() {
        if (!this.state.address) {
            this.state.pendingSpendSats = 0;
        } else {
            const { totalSats } = getPendingSpendTotal(this.state.address);
            this.state.pendingSpendSats = totalSats;
        }
        this.notify();
    }

    markSpentOutpoints(outpoints: string[]) {
        // Kept for compatibility with send flow, but read-only Light API does not expose UTXO state here.
        void outpoints;
    }

    async fetch() {
        const addr = this.state.address;
        if (!addr) return;

        this.state.status = "loading";
        this.state.error = null;
        this.state.rawUtxoSumLastRequestUrl = `/api/wallet/address/${addr}`;
        this.state.rawUtxoSumError = null;
        this.notify();

        try {
            const data = await pepewLightClient.getAddress(addr);
            const confirmedSats = Number(data?.balance?.confirmed ?? 0);
            if (!Number.isFinite(confirmedSats)) {
                throw new Error("Invalid PEPEW Light API balance response");
            }

            const oldSum = this.state.utxoSumSats;
            const newSum = Math.round(confirmedSats);

            this.state.utxos = [];
            this.state.utxoSumSats = newSum;
            this.state.rawUtxoSumStatus = 200;
            this.state.status = "ok";
            this.state.lastUpdate = Date.now();

            if (oldSum !== null && newSum !== oldSum) {
                this.state.optimisticDeductionSats = 0;
            }

            this.notify();
        } catch (e: any) {
            this.state.status = "error";
            const errDetail = e.message || "Network error";
            this.state.error = errDetail;
            this.state.rawUtxoSumError = errDetail;
            this.state.rawUtxoSumStatus = null;
            this.notify();
        }
    }

    scheduleRefresh(delays = [0, 2000, 5000]) {
        const baseline = this.state.utxoSumSats;
        delays.forEach((delay) => {
            setTimeout(() => {
                if (delay !== 0 && this.state.utxoSumSats !== baseline) return;
                this.fetch();
                this.updatePending();
            }, delay);
        });
    }
}

export const walletStore = new WalletStore();
