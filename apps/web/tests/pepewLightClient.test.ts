import assert from "node:assert/strict";
import { PepewLightApiClient } from "../src/lib/pepewLightClient.ts";


// Mock fetch globally
const originalFetch = globalThis.fetch;

// Utility to defer mock response
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  console.log("Running pepewLightClient tests...");

  // Test Case 1: Success mapping
  {
    globalThis.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb")) {
        return {
          ok: true,
          json: async () => ({
            address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
            balance: {
              confirmed: 100000000,
              unconfirmed: 0,
              confirmed_pepew: "1.00000000",
              unconfirmed_pepew: "0.00000000",
            },
            history: [],
            source: "electrumx",
            read_only: true,
          }),
        } as any;
      }
      if (urlStr.includes("/api/wallet/history/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb")) {
        return {
          ok: true,
          json: async () => ({
            address: "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb",
            history: [{ txid: "a".repeat(64), height: 100 }],
            mempool: [],
            source: "electrumx",
            read_only: true,
          }),
        } as any;
      }
      if (urlStr.includes("/api/wallet/tx/" + "a".repeat(64))) {
        return {
          ok: true,
          json: async () => ({
            txid: "a".repeat(64),
            data: { hex: "01000000..." },
            source: "electrumx",
            read_only: true,
          }),
        } as any;
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    };

    const client = new PepewLightApiClient("http://localhost:8088");
    const addrData = await client.getAddress("PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb");
    assert.equal(addrData.address, "PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb");
    assert.equal(addrData.balance.confirmed_pepew, "1.00000000");

    const histData = await client.getHistory("PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb");
    assert.equal(histData.history[0].txid, "a".repeat(64));

    const txData = await client.getTx("a".repeat(64));
    assert.equal(txData.txid, "a".repeat(64));
    assert.equal(txData.data.hex, "01000000...");

    console.log("  - Success mapping: PASSED");
  }

  // Test Case 2: Timeout handling
  {
    globalThis.fetch = async (url: any, options: any) => {
      const signal = options?.signal;
      await sleep(150); // Sleep longer than client timeout
      if (signal?.aborted) {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      }
      return { ok: true, json: async () => ({}) } as any;
    };

    const client = new PepewLightApiClient("http://localhost:8088", 50); // 50ms timeout
    await assert.rejects(
      async () => {
        await client.getAddress("PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb");
      },
      (err: any) => {
        return err.message.includes("Balance lookup timed out");
      }
    );

    console.log("  - Timeout handling: PASSED");
  }

  // Test Case 3: Invalid Response (HTTP error)
  {
    globalThis.fetch = async (url: any, options: any) => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "unsupported_address_prefix",
          },
        }),
      } as any;
    };

    const client = new PepewLightApiClient("http://localhost:8088");
    await assert.rejects(
      async () => {
        await client.getAddress("invalid");
      },
      (err: any) => {
        return err.message.includes("Invalid PEPEW address");
      }
    );

    console.log("  - Invalid response error reporting: PASSED");
  }

  // Test Case 4: Rate limit mapping
  {
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 429,
        json: async () => ({ detail: "rate limit exceeded" }),
      } as any;
    };

    const client = new PepewLightApiClient("http://localhost:8088");
    await assert.rejects(
      async () => {
        await client.getHistory("PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb");
      },
      (err: any) => {
        return err.message.includes("Too many requests");
      }
    );

    console.log("  - Rate limit error reporting: PASSED");
  }

  // Restore fetch
  globalThis.fetch = originalFetch;
  console.log("All pepewLightClient tests passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
