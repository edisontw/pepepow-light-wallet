import assert from "node:assert/strict";
import {
  MAX_AUTO_CONSOLIDATION_ROUNDS,
  estimateAutoConsolidation,
  runAutoConsolidation,
  type AutoConsolidationProgress,
} from "../src/lib/consolidationAuto";
import { estimateConsolidationFee, prepareConsolidationPlan } from "../src/lib/consolidationPolicy";

type Utxo = { txid: string; vout: number; value: number; height: number };
const txid = (n: number) => n.toString(16).padStart(64, "0");
const utxo = (n: number): Utxo => ({ txid: txid(n), vout: 0, value: 2_000_000, height: 100 });
const snapshot = (n: number): Utxo[] => Array.from({ length: n }, (_, i) => utxo(i + 1));

async function testCompletesOnlyAfterConfirmation() {
  let current = snapshot(100);
  const initial = prepareConsolidationPlan(current, new Set(), 40);
  let count = 0;
  let loads = 0;
  const phases: AutoConsolidationProgress[] = [];
  let pendingTxid = "";
  let lastSpent: Set<string> = new Set();
  const result = await runAutoConsolidation({
    initialPlan: initial, maxRounds: MAX_AUTO_CONSOLIDATION_ROUNDS, batchSize: 40, maxTotalFeeAtomic: 10_000_000_000n,
    getExcludedOutpoints: () => new Set(),
    getUtxos: async () => {
      loads += 1;
      if (loads % 2 === 1) return current; // stale indexer: no advance
      current = current.filter((u) => !lastSpent.has(`${u.txid}:${u.vout}`));
      current.push({ txid: pendingTxid, vout: 0, value: 70_000_000, height: 101 });
      return current;
    },
    broadcastRound: async (plan) => {
      count += 1;
      const selected = new Set(plan.selected.map((u) => `${u.txid}:${u.vout}`));
      assert.equal(selected.size, plan.selected.length);
      lastSpent = selected;
      pendingTxid = txid(5000 + count);
      return pendingTxid;
    },
    isPaused: () => false,
    onProgress: (p) => phases.push(p),
    delay: async () => {},
    pollMs: 0,
    maxPolls: 6,
  });
  assert.equal(result.status, "done");
  assert.equal(result.completedRounds, 3);
  assert.equal(count, 3);
  assert.ok(phases.some((p) => p.phase === "waiting"));
  assert.equal(current.length, 1);
}
async function testNeverContinuesOnUnconfirmedOutput() {
  const initial = snapshot(70);
  let broadcasts = 0;
  const result = await runAutoConsolidation({
    initialPlan: prepareConsolidationPlan(initial, new Set(), 40),
    batchSize: 40, maxTotalFeeAtomic: 10_000_000_000n, maxRounds: 5,
    getExcludedOutpoints: () => new Set(),
    broadcastRound: async () => { broadcasts += 1; return txid(999); },
    getUtxos: async () => [...initial.filter((u) => u.txid !== txid(1)), { txid: txid(999), vout: 0, height: 0, value: 5_000_000 }],
    isPaused: () => false, onProgress: () => {}, delay: async () => {}, pollMs: 0, maxPolls: 2,
  });
  assert.equal(result.status, "paused");
  assert.equal(broadcasts, 1);
}
async function testStopBetweenRounds() {
  const initial = snapshot(60);
  let broadcasts = 0;
  let pause = false;
  const result = await runAutoConsolidation({
    initialPlan: prepareConsolidationPlan(initial, new Set(), 40),
    batchSize: 40, maxTotalFeeAtomic: 10_000_000_000n, maxRounds: 5,
    getExcludedOutpoints: () => new Set(),
    broadcastRound: async () => { broadcasts += 1; pause = true; return txid(999); },
    getUtxos: async () => { throw Error("must not poll after pause"); },
    isPaused: () => pause, onProgress: () => {}, delay: async () => {}, pollMs: 0, maxPolls: 1,
  });
  assert.equal(result.status, "paused");
  assert.equal(broadcasts, 1);
}
async function testMaxRounds() {
  let current = snapshot(100);
  let broadcasts = 0;
  let selected = new Set<string>();
  let out = "";
  const result = await runAutoConsolidation({
    initialPlan: prepareConsolidationPlan(current, new Set(), 20),
    batchSize: 20, maxTotalFeeAtomic: 10_000_000_000n, maxRounds: 2,
    getExcludedOutpoints: () => new Set(),
    broadcastRound: async (plan) => {
      broadcasts += 1;
      selected = new Set(plan.selected.map((u) => `${u.txid}:${u.vout}`));
      out = txid(8000 + broadcasts); return out;
    },
    getUtxos: async () => {
      current = current.filter((u) => !selected.has(`${u.txid}:${u.vout}`));
      current.push({ txid: out, vout: 0, height: 200, value: 50_000_000 });
      return current;
    },
    isPaused: () => false, onProgress: () => {}, delay: async () => {}, pollMs: 0, maxPolls: 1,
  });
  assert.equal(result.status, "limit");
  assert.equal(broadcasts, 2);
  assert.ok((result.eligibleUtxos ?? 0) > 1);
}
async function testInvalidLimitsAndAmbiguousBroadcast() {
  const initial = prepareConsolidationPlan(snapshot(4), new Set(), 4);
  const options = {
    initialPlan: initial, batchSize: 4, maxTotalFeeAtomic: 10_000_000_000n, maxRounds: MAX_AUTO_CONSOLIDATION_ROUNDS + 1, getExcludedOutpoints: () => new Set(),
    broadcastRound: async () => txid(200),
    getUtxos: async () => snapshot(4), isPaused: () => false, onProgress: () => {},
  };
  await assert.rejects(runAutoConsolidation(options), /round limit/);
  let attempts = 0;
  await assert.rejects(runAutoConsolidation({
    ...options, maxRounds: 3, broadcastRound: async () => {
      attempts += 1; throw new Error("Broadcast uncertain");
    },
  }), /uncertain/);
  assert.equal(attempts, 1);
}

function testAutoSessionEstimates() {
  const small = estimateAutoConsolidation(2, 20);
  assert.equal(small.rounds, 1);
  assert.equal(small.estimatedTotalFeeAtomic, estimateConsolidationFee(2));
  const medium = estimateAutoConsolidation(180, 80);
  assert.equal(medium.rounds, 3);
  assert.equal(medium.estimatedTotalFeeAtomic,
    estimateConsolidationFee(80) * 2n + estimateConsolidationFee(22));
  const thousand = estimateAutoConsolidation(1000, 80);
  assert.equal(thousand.rounds, 13);
  assert.ok(thousand.estimatedTotalFeeAtomic > 0n);
  assert.throws(() => estimateAutoConsolidation(79_002, 80), /Too many UTXOs/);
  assert.throws(() => estimateAutoConsolidation(1, 40), /At least two/);
}

async function testOneApprovalCompletesThousandUtxos() {
  let current = snapshot(1000);
  const estimate = estimateAutoConsolidation(current.length, 80);
  let broadcasts = 0;
  let selectedOutpoints = new Set<string>();
  let newlyBroadcast = "";
  const initialPlan = prepareConsolidationPlan(current, new Set(), 80);
  const result = await runAutoConsolidation({
    initialPlan, batchSize: 80, maxRounds: estimate.rounds,
    maxTotalFeeAtomic: estimate.estimatedTotalFeeAtomic,
    getExcludedOutpoints: () => new Set(),
    broadcastRound: async (plan) => {
      broadcasts += 1;
      selectedOutpoints = new Set(plan.selected.map((u) => `${u.txid}:${u.vout}`));
      newlyBroadcast = txid(10000 + broadcasts);
      return newlyBroadcast;
    },
    getUtxos: async () => {
      current = current.filter((u) => !selectedOutpoints.has(`${u.txid}:${u.vout}`));
      current.push({ txid: newlyBroadcast, vout: 0, value: 5_000_000, height: 200 });
      return current;
    },
    isPaused: () => false, onProgress: () => {},
    delay: async () => {}, pollMs: 0, maxPolls: 1,
  });
  assert.equal(result.status, "done");
  assert.equal(result.completedRounds, estimate.rounds);
  assert.equal(broadcasts, 13);
  assert.equal(current.length, 1);
}

async function testFeeBudgetStopsBeforeAnotherBroadcast() {
  let current = snapshot(100);
  const firstPlan = prepareConsolidationPlan(current, new Set(), 40);
  let broadcasts = 0;
  let spent = new Set<string>();
  let returnedTxid = "";
  const result = await runAutoConsolidation({
    initialPlan: firstPlan, batchSize: 40, maxRounds: 10,
    maxTotalFeeAtomic: firstPlan.feeAtomic,
    getExcludedOutpoints: () => new Set(),
    broadcastRound: async (plan) => {
      broadcasts += 1;
      spent = new Set(plan.selected.map((u) => `${u.txid}:${u.vout}`));
      returnedTxid = txid(9000 + broadcasts);
      return returnedTxid;
    },
    getUtxos: async () => {
      current = current.filter((u) => !spent.has(`${u.txid}:${u.vout}`));
      current.push({ txid: returnedTxid, vout: 0, height: 200, value: 5_000_000 });
      return current;
    },
    isPaused: () => false, onProgress: () => {}, delay: async () => {}, pollMs: 0, maxPolls: 1,
  });
  assert.equal(result.status, "budget");
  assert.equal(result.completedRounds, 1);
  assert.equal(broadcasts, 1);
}

testAutoSessionEstimates();
await testOneApprovalCompletesThousandUtxos();
await testFeeBudgetStopsBeforeAnotherBroadcast();

await testCompletesOnlyAfterConfirmation();
await testNeverContinuesOnUnconfirmedOutput();
await testStopBetweenRounds();
await testMaxRounds();
await testInvalidLimitsAndAmbiguousBroadcast();
console.log("Automatic consolidation flow tests passed.");
