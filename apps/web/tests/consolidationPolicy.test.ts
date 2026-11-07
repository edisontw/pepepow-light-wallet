import assert from "node:assert/strict";
import {
  estimateConsolidationBytes,
  estimateConsolidationFee,
  prepareConsolidationPlan,
  selectConfirmedConsolidationUtxos,
  MAX_CONSOLIDATION_INPUTS,
} from "../src/lib/consolidationPolicy";

const txid = (n: number) => n.toString(16).padStart(64, "0");
const utxo = (n: number, value = 2_000_000, height = 100) => ({ txid: txid(n), vout: 0, value, height });

const mixed = [
  utxo(4, 500_000, 0),  // unconfirmed
  utxo(3, 300_000),
  utxo(2, 100_000),
  utxo(1, 200_000),
];
assert.deepEqual(selectConfirmedConsolidationUtxos(mixed, new Set(), 20).map((u) => u.value), [100_000, 200_000, 300_000]);
assert.deepEqual(selectConfirmedConsolidationUtxos(mixed, new Set([`${txid(2)}:0`]), 20).map((u) => u.value), [200_000, 300_000]);

const duplicates = [utxo(1), utxo(1), utxo(2), { ...utxo(3), value: Number.MAX_SAFE_INTEGER + 1 }];
assert.equal(selectConfirmedConsolidationUtxos(duplicates, new Set(), 20).length, 2);

const many = Array.from({ length: 150 }, (_, i) => utxo(i + 1));
const plan = prepareConsolidationPlan(many, new Set(), MAX_CONSOLIDATION_INPUTS);
assert.equal(plan.selected.length, 80);
assert.equal(plan.totalCandidates, 150);
assert.equal(plan.estimatedBytes, 11_884);
assert.equal(plan.feeAtomic, 1_200_000n);
assert.equal(plan.totalInAtomic, 160_000_000n);
assert.equal(plan.outputAtomic, 158_800_000n);
assert.equal(estimateConsolidationBytes(2), 340);
assert.equal(estimateConsolidationFee(2), 100_000n);
assert.throws(() => estimateConsolidationBytes(81), /Invalid/);
assert.throws(() => prepareConsolidationPlan([utxo(1)], new Set(), 40), /At least two/);
assert.throws(() => prepareConsolidationPlan([utxo(1), utxo(2)], new Set(), 81), /Invalid/);
assert.throws(() => prepareConsolidationPlan([utxo(1, 50_000), utxo(2, 50_000)], new Set(), 20), /fee and dust/);
console.log("Consolidation policy tests passed.");
