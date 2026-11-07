import {
  MAX_CONSOLIDATION_INPUTS,
  estimateConsolidationFee,
  prepareConsolidationPlan,
  selectConfirmedConsolidationUtxos,
  type ConsolidationCandidate,
  type ConsolidationPlan,
} from "./consolidationPolicy";

// Emergency guard only; a normal session stops as soon as all eligible UTXOs are consolidated.
export const MAX_AUTO_CONSOLIDATION_ROUNDS = 1000;

export interface AutoConsolidationEstimate {
  rounds: number;
  estimatedTotalFeeAtomic: bigint;
}

/**
 * One confirmed self-return output replaces each selected batch.
 * Preview the exact initial UTXO reduction and estimated cumulative fee.
 * The plan is a bounded user authorization, not an infinite background job.
 */
export function estimateAutoConsolidation(eligibleCount: number, batchSize: number): AutoConsolidationEstimate {
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 2) {
    throw new Error("At least two eligible UTXOs are required.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 2 || batchSize > MAX_CONSOLIDATION_INPUTS) {
    throw new Error("Invalid consolidation batch size.");
  }
  let remaining = eligibleCount;
  let rounds = 0;
  let estimatedTotalFeeAtomic = 0n;
  while (remaining > 1 && rounds < MAX_AUTO_CONSOLIDATION_ROUNDS) {
    const inputCount = Math.min(remaining, batchSize);
    estimatedTotalFeeAtomic += estimateConsolidationFee(inputCount);
    remaining = remaining - inputCount + 1;
    rounds += 1;
  }
  if (remaining > 1) {
    throw new Error("Too many UTXOs for one automatic session. Increase the batch size or consolidate in stages.");
  }
  return { rounds, estimatedTotalFeeAtomic };
}
export const AUTO_CONSOLIDATION_POLL_MS = 12_000;
export const AUTO_CONSOLIDATION_MAX_POLLS = 20; // ~4 min/round, no polling storm

export type AutoConsolidationPhase = "broadcasting" | "waiting" | "preparing" | "done" | "limit" | "paused";

export interface AutoConsolidationProgress {
  phase: AutoConsolidationPhase;
  round: number;
  maxRounds: number;
  completedRounds: number;
  lastTxid?: string;
  eligibleUtxos?: number;
  poll?: number;
}

export interface AutoConsolidationOutcome {
  status: "done" | "limit" | "paused";
  completedRounds: number;
  lastTxid?: string;
  eligibleUtxos?: number;
}

export interface AutoConsolidationOptions<T extends ConsolidationCandidate> {
  initialPlan: ConsolidationPlan<T>;
  batchSize: number;
  maxRounds: number;
  getUtxos: () => Promise<T[]>;
  getExcludedOutpoints: () => ReadonlySet<string>;
  broadcastRound: (plan: ConsolidationPlan<T>) => Promise<string>;
  isPaused: () => boolean;
  onProgress: (progress: AutoConsolidationProgress) => void;
  delay?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxPolls?: number;
}

export function getConsolidationOutpoint(utxo: Pick<ConsolidationCandidate, "txid" | "vout">): string {
  return `${utxo.txid.toLowerCase()}:${utxo.vout}`;
}

async function waitForRoundConfirmation<T extends ConsolidationCandidate>(
  opts: AutoConsolidationOptions<T>,
  plan: ConsolidationPlan<T>,
  txid: string,
  completedRounds: number,
): Promise<{ status: "ready"; utxos: T[] } | { status: "paused" | "timeout" }> {
  const selected = new Set(plan.selected.map(getConsolidationOutpoint));
  const pollMs = opts.pollMs ?? AUTO_CONSOLIDATION_POLL_MS;
  const maxPolls = opts.maxPolls ?? AUTO_CONSOLIDATION_MAX_POLLS;
  const delay = opts.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 30 || !Number.isFinite(pollMs) || pollMs < 0) {
    throw new Error("Invalid consolidation polling options.");
  }
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    if (opts.isPaused()) return { status: "paused" };
    opts.onProgress({
      phase: "waiting", round: completedRounds, maxRounds: opts.maxRounds,
      completedRounds, lastTxid: txid, poll: attempt,
    });
    await delay(pollMs);
    if (opts.isPaused()) return { status: "paused" };
    const utxos = await opts.getUtxos();
    if (opts.isPaused()) return { status: "paused" };
    const remaining = new Set(utxos.map(getConsolidationOutpoint));
    const spentInputsGone = [...selected].every((outpoint) => !remaining.has(outpoint));
    const outputConfirmed = utxos.some((utxo) =>
      utxo.txid.toLowerCase() === txid.toLowerCase() && utxo.height > 0 && utxo.value > 0
    );
    // Never spend the next batch based on stale API data, or unconfirmed change.
    if (spentInputsGone && outputConfirmed) return { status: "ready", utxos };
  }
  return { status: "timeout" };
}

/**
 * Single browser session, user-authorized number of rounds estimated from initial UTXO count.
 * Each accepted transaction must be indexed AND confirmed before the next round.
 * Never retries a failed or ambiguous broadcast; never automatically resumes on reload.
 */
export async function runAutoConsolidation<T extends ConsolidationCandidate>(
  opts: AutoConsolidationOptions<T>,
): Promise<AutoConsolidationOutcome> {
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 2 || opts.batchSize > MAX_CONSOLIDATION_INPUTS) {
    throw new Error("Invalid consolidation batch size.");
  }
  if (!Number.isInteger(opts.maxRounds) || opts.maxRounds < 1 || opts.maxRounds > MAX_AUTO_CONSOLIDATION_ROUNDS) {
    throw new Error("Invalid automatic consolidation round limit.");
  }
  if (opts.initialPlan.selected.length < 2 || opts.initialPlan.selected.length > opts.batchSize) {
    throw new Error("Invalid initial consolidation preview.");
  }

  let plan = opts.initialPlan;
  let lastTxid: string | undefined;
  let completedRounds = 0;

  while (completedRounds < opts.maxRounds) {
    if (opts.isPaused()) return { status: "paused", completedRounds, lastTxid };
    const round = completedRounds + 1;
    opts.onProgress({ phase: "broadcasting", round, maxRounds: opts.maxRounds, completedRounds, lastTxid });
    const txid = await opts.broadcastRound(plan);
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("Consolidation broadcast returned an invalid txid.");
    lastTxid = txid;
    completedRounds += 1;

    const confirmation = await waitForRoundConfirmation(opts, plan, txid, completedRounds);
    if (confirmation.status !== "ready") {
      const outcome = { status: "paused" as const, completedRounds, lastTxid };
      opts.onProgress({
        phase: "paused", round: completedRounds, maxRounds: opts.maxRounds, completedRounds, lastTxid,
      });
      return outcome;
    }
    if (opts.isPaused()) {
      opts.onProgress({ phase: "paused", round: completedRounds, maxRounds: opts.maxRounds, completedRounds, lastTxid });
      return { status: "paused", completedRounds, lastTxid };
    }

    const excluded = opts.getExcludedOutpoints();
    const eligible = selectConfirmedConsolidationUtxos(confirmation.utxos, excluded, MAX_CONSOLIDATION_INPUTS);
    // Count all eligible outputs, not only the selected batch.
    const eligibleCount = confirmation.utxos.filter((u) =>
      u.height > 0 && u.value > 0 && !excluded.has(getConsolidationOutpoint(u))
    ).length;
    if (eligibleCount < 2) {
      opts.onProgress({
        phase: "done", round: completedRounds, maxRounds: opts.maxRounds,
        completedRounds, lastTxid, eligibleUtxos: eligibleCount,
      });
      return { status: "done", completedRounds, lastTxid, eligibleUtxos: eligibleCount };
    }
    if (completedRounds >= opts.maxRounds) {
      opts.onProgress({
        phase: "limit", round: completedRounds, maxRounds: opts.maxRounds,
        completedRounds, lastTxid, eligibleUtxos: eligibleCount,
      });
      return { status: "limit", completedRounds, lastTxid, eligibleUtxos: eligibleCount };
    }
    // Do not continue if a fresh next batch cannot pay its own fee.
    opts.onProgress({
      phase: "preparing", round: completedRounds + 1, maxRounds: opts.maxRounds,
      completedRounds, lastTxid, eligibleUtxos: eligibleCount,
    });
    if (eligible.length < 2) {
      opts.onProgress({
        phase: "paused", round: completedRounds, maxRounds: opts.maxRounds,
        completedRounds, lastTxid, eligibleUtxos: eligibleCount,
      });
      return { status: "paused", completedRounds, lastTxid, eligibleUtxos: eligibleCount };
    }
    try {
      plan = prepareConsolidationPlan(confirmation.utxos, excluded, opts.batchSize);
    } catch {
      // No successful second preview: stop rather than submitting a risky tx.
      opts.onProgress({
        phase: "paused", round: completedRounds, maxRounds: opts.maxRounds,
        completedRounds, lastTxid, eligibleUtxos: eligibleCount,
      });
      return { status: "paused", completedRounds, lastTxid, eligibleUtxos: eligibleCount };
    }
  }
  return { status: "limit", completedRounds, lastTxid };
}
