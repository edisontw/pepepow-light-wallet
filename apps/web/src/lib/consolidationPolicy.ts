/**
 * Conservative single-round PEPEW UTXO consolidation policy.
 * Fees mirror the Android v2 started-kB fee model; signing stays in the browser.
 */
export interface ConsolidationCandidate {
  txid: string;
  vout: number;
  height: number;
  value: number; // PEPEW Light API atomic units, safe integers only
}

export const MAX_CONSOLIDATION_INPUTS = 80;
export const MIN_CONSOLIDATION_INPUTS = 2;
export const MAX_CONSOLIDATION_TX_BYTES = 100_000;
export const CONSOLIDATION_FEE_PER_KB_ATOMIC = 100_000n;
export const CONSOLIDATION_DUST_ATOMIC = 546n;

export function estimateConsolidationBytes(inputCount: number): number {
  if (!Number.isInteger(inputCount) || inputCount < MIN_CONSOLIDATION_INPUTS || inputCount > MAX_CONSOLIDATION_INPUTS) {
    throw new Error("Invalid consolidation input count.");
  }
  return 10 + inputCount * 148 + 34; // legacy P2PKH, one output
}

export function estimateConsolidationFee(inputCount: number): bigint {
  const estimatedBytes = BigInt(estimateConsolidationBytes(inputCount));
  return ((estimatedBytes + 999n) / 1000n) * CONSOLIDATION_FEE_PER_KB_ATOMIC;
}

export function selectConfirmedConsolidationUtxos<T extends ConsolidationCandidate>(
  utxos: T[],
  excludedOutpoints: ReadonlySet<string>,
  maxInputs: number,
): T[] {
  if (!Number.isInteger(maxInputs) || maxInputs < MIN_CONSOLIDATION_INPUTS || maxInputs > MAX_CONSOLIDATION_INPUTS) {
    throw new Error("Invalid consolidation batch size.");
  }
  if (!Array.isArray(utxos)) throw new Error("Invalid UTXO response.");

  const seen = new Set<string>();
  return utxos
    .filter((utxo) => {
      if (!utxo || !/^[a-fA-F0-9]{64}$/.test(utxo.txid)) return false;
      if (!Number.isInteger(utxo.vout) || utxo.vout < 0 || utxo.vout > 0xffffffff) return false;
      if (!Number.isInteger(utxo.height) || utxo.height <= 0) return false;
      if (!Number.isSafeInteger(utxo.value) || utxo.value <= 0) return false;
      const key = `${utxo.txid.toLowerCase()}:${utxo.vout}`;
      if (excludedOutpoints.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.value - b.value || a.txid.localeCompare(b.txid) || a.vout - b.vout)
    .slice(0, maxInputs);
}

export interface ConsolidationPlan<T extends ConsolidationCandidate> {
  selected: T[];
  totalCandidates: number;
  totalInAtomic: bigint;
  feeAtomic: bigint;
  outputAtomic: bigint;
  estimatedBytes: number;
}

export function prepareConsolidationPlan<T extends ConsolidationCandidate>(
  utxos: T[],
  excludedOutpoints: ReadonlySet<string>,
  maxInputs: number,
): ConsolidationPlan<T> {
  const eligible = selectConfirmedConsolidationUtxos(utxos, excludedOutpoints, MAX_CONSOLIDATION_INPUTS);
  if (eligible.length < MIN_CONSOLIDATION_INPUTS) {
    throw new Error("At least two confirmed, unspent UTXOs are needed for consolidation.");
  }
  const selected = eligible.slice(0, maxInputs);
  if (!Number.isInteger(maxInputs) || maxInputs < MIN_CONSOLIDATION_INPUTS || maxInputs > MAX_CONSOLIDATION_INPUTS) {
    throw new Error("Invalid consolidation batch size.");
  }
  const estimatedBytes = estimateConsolidationBytes(selected.length);
  if (estimatedBytes > MAX_CONSOLIDATION_TX_BYTES) throw new Error("Consolidation transaction is too large.");
  const feeAtomic = estimateConsolidationFee(selected.length);
  const totalInAtomic = selected.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const outputAtomic = totalInAtomic - feeAtomic;
  if (outputAtomic <= CONSOLIDATION_DUST_ATOMIC) {
    throw new Error("Selected UTXOs cannot cover the consolidation fee and dust threshold.");
  }
  return { selected, totalCandidates: eligible.length, totalInAtomic, feeAtomic, outputAtomic, estimatedBytes };
}
