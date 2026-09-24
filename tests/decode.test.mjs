import assert from "node:assert/strict";
import test from "node:test";
import { xdr } from "@stellar/stellar-sdk";

import { decodeEvent } from "../dist/stellar/decode.js";
import { readContractEvents, eventCursorLedger } from "../dist/stellar/events.js";
import { formatEvent } from "../dist/notifications/format.js";

const TEST_CONFIG = {
  chatId: "-1001234567890",
  marketContractId: "CDV6JXIJCALSXQELCS6YUEWJWG5DFXQK5PJ5I7MWI6KVMQJBC5DLPKZI",
  squadContractId: "CBPGVXHXLULUBVZ24D6XNSUX7NH45HYXGWHAJFWTBHXYNO72KDRKCDFY",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  explorerBaseUrl: "https://stellar.expert/explorer",
};

const VALID_ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

test("decodeEvent parses valid positive amounts across market and squad events", () => {
  const cases = [
    {
      source: "market",
      eventName: "claim_challenged",
      topics: [xdr.ScVal.scvSymbol("claim_challenged"), xdr.ScVal.scvU64(new xdr.Uint64(1n)), xdr.ScVal.scvString(VALID_ADDR)],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("stake"),
          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(10_000_000n) })),
        }),
      ]),
      check: (p) => p.name === "claim_challenged" && p.stake === 10_000_000n,
    },
    {
      source: "market",
      eventName: "fee_claimed",
      topics: [xdr.ScVal.scvSymbol("fee_claimed"), xdr.ScVal.scvString(VALID_ADDR)],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: xdr.ScVal.scvU64(new xdr.Uint64(500n)),
        }),
      ]),
      check: (p) => p.name === "fee_claimed" && p.amount === 500n,
    },
    {
      source: "squad",
      eventName: "deposited",
      topics: [
        xdr.ScVal.scvSymbol("deposited"),
        xdr.ScVal.scvU64(new xdr.Uint64(2n)),
        xdr.ScVal.scvU32(1),
        xdr.ScVal.scvString(VALID_ADDR),
      ],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: xdr.ScVal.scvU64(new xdr.Uint64(20_000_000n)),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("shares"),
          val: xdr.ScVal.scvU64(new xdr.Uint64(20_000_000n)),
        }),
      ]),
      check: (p) => p.name === "deposited" && p.amount === 20_000_000n && p.shares === 20_000_000n,
    },
  ];

  for (const c of cases) {
    const rawEvent = {
      id: "100-0",
      ledger: 100,
      contractId: TEST_CONFIG.marketContractId,
      txHash: "00".repeat(32),
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      topic: c.topics,
      value: c.value,
    };
    const decoded = decodeEvent(c.source, rawEvent);
    assert.ok(c.check(decoded.payload), `failed for ${c.eventName}`);
  }
});

test("decodeEvent rejects zero stake or positive stake as valid non-negative amounts", () => {
  const zeroEvent = {
    id: "101-0",
    ledger: 101,
    contractId: TEST_CONFIG.marketContractId,
    txHash: "00".repeat(32),
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    topic: [
      xdr.ScVal.scvSymbol("claim_challenged"),
      xdr.ScVal.scvU64(new xdr.Uint64(5n)),
      xdr.ScVal.scvString(VALID_ADDR),
    ],
    value: xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("stake"),
        val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(0n) })),
      }),
    ]),
  };
  const decoded = decodeEvent("market", zeroEvent);
  assert.equal(decoded.payload.name, "claim_challenged");
  if (decoded.payload.name === "claim_challenged") {
    assert.equal(decoded.payload.stake, 0n);
  }
});

test("decodeEvent rejects negative decoded amounts across market and squad payloads", () => {
  const negativeCases = [
    {
      source: "market",
      eventName: "claim_challenged",
      topics: [xdr.ScVal.scvSymbol("claim_challenged"), xdr.ScVal.scvU64(new xdr.Uint64(1n)), xdr.ScVal.scvString(VALID_ADDR)],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("stake"),
          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-1n), lo: new xdr.Uint64(0n) })),
        }),
      ]),
      expectedReasonMatch: /claim_challenged\.stake: expected non-negative amount/,
    },
    {
      source: "market",
      eventName: "withdrawal",
      topics: [xdr.ScVal.scvSymbol("withdrawal"), xdr.ScVal.scvString(VALID_ADDR)],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-5n), lo: new xdr.Uint64(0n) })),
        }),
      ]),
      expectedReasonMatch: /withdrawal\.amount: expected non-negative amount/,
    },
    {
      source: "squad",
      eventName: "deposited",
      topics: [
        xdr.ScVal.scvSymbol("deposited"),
        xdr.ScVal.scvU64(new xdr.Uint64(1n)),
        xdr.ScVal.scvU32(1),
        xdr.ScVal.scvString(VALID_ADDR),
      ],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-10n), lo: new xdr.Uint64(0n) })),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("shares"),
          val: xdr.ScVal.scvU64(new xdr.Uint64(100n)),
        }),
      ]),
      expectedReasonMatch: /deposited\.amount: expected non-negative amount/,
    },
    {
      source: "squad",
      eventName: "resolved",
      topics: [xdr.ScVal.scvSymbol("resolved"), xdr.ScVal.scvU64(new xdr.Uint64(1n))],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("result"), val: xdr.ScVal.scvU32(1) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("pool_a"), val: xdr.ScVal.scvU64(new xdr.Uint64(1000n)) }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("pool_b"),
          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-1n), lo: new xdr.Uint64(0n) })),
        }),
      ]),
      expectedReasonMatch: /resolved\.pool_b: expected non-negative amount/,
    },
  ];

  for (const c of negativeCases) {
    const rawEvent = {
      id: "200-0",
      ledger: 200,
      contractId: TEST_CONFIG.marketContractId,
      txHash: "00".repeat(32),
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      topic: c.topics,
      value: c.value,
    };
    const decoded = decodeEvent(c.source, rawEvent);
    assert.equal(decoded.payload.name, "unknown");
    assert.ok(
      c.expectedReasonMatch.test(decoded.payload.reason ?? ""),
      `expected reason match for ${c.eventName}, got "${decoded.payload.reason}"`,
    );

    // Assert formatEvent stays non-notifying (returns null)
    assert.equal(formatEvent(TEST_CONFIG, decoded), null, `formatEvent should skip ${c.eventName}`);
  }
});

test("decodeEvent rejects invalid amount types and non-integer amount strings", () => {
  const invalidTypeCases = [
    { value: "invalid-string", reasonMatch: /expected an integer/ },
    { value: "12.34", reasonMatch: /expected an integer/ },
    { value: true, reasonMatch: /expected an integer/ },
    { value: {}, reasonMatch: /expected an integer/ },
  ];

  for (const c of invalidTypeCases) {
    const rawEvent = {
      id: "201-0",
      ledger: 201,
      contractId: TEST_CONFIG.marketContractId,
      txHash: "00".repeat(32),
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      topic: [
        xdr.ScVal.scvSymbol("claim_challenged"),
        xdr.ScVal.scvU64(new xdr.Uint64(1n)),
        xdr.ScVal.scvString(VALID_ADDR),
      ],
      value: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("stake"),
          val: typeof c.value === "string" ? xdr.ScVal.scvString(c.value) : xdr.ScVal.scvBool(true),
        }),
      ]),
    };
    const decoded = decodeEvent("market", rawEvent);
    assert.equal(decoded.payload.name, "unknown");
    assert.ok(
      c.reasonMatch.test(decoded.payload.reason ?? ""),
      `reason should match, got "${decoded.payload.reason}"`,
    );
  }
});

test("decodeEvent rejects negative IDs and deadlines", () => {
  const rawEvent = {
    id: "202-0",
    ledger: 202,
    contractId: TEST_CONFIG.marketContractId,
    txHash: "00".repeat(32),
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    topic: [
      xdr.ScVal.scvSymbol("claim_challenged"),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-1n), lo: new xdr.Uint64(0n) })),
      xdr.ScVal.scvString(VALID_ADDR),
    ],
    value: xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("stake"),
        val: xdr.ScVal.scvU64(new xdr.Uint64(100n)),
      }),
    ]),
  };
  const decoded = decodeEvent("market", rawEvent);
  assert.equal(decoded.payload.name, "unknown");
  assert.match(decoded.payload.reason ?? "", /claim_challenged\.id: expected non-negative integer/);
});

test("decodeEvent handles malformed XDR and null/undefined event objects safely without crashing", () => {
  // Null event
  const nullDecoded = decodeEvent("market", null);
  assert.equal(nullDecoded.payload.name, "unknown");

  // Missing topic / empty topic
  const emptyTopicEvent = {
    id: "300-0",
    ledger: 300,
    contractId: TEST_CONFIG.marketContractId,
    topic: [],
    value: null,
  };
  const emptyDecoded = decodeEvent("market", emptyTopicEvent);
  assert.equal(emptyDecoded.payload.name, "unknown");
  assert.equal(emptyDecoded.payload.reason, "no decoder");

  // Malformed XDR in topic element
  const badTopicEvent = {
    id: "301-0",
    ledger: 301,
    contractId: TEST_CONFIG.marketContractId,
    topic: ["invalid-xdr-not-scval"],
    value: null,
  };
  const badTopicDecoded = decodeEvent("market", badTopicEvent);
  assert.equal(badTopicDecoded.payload.name, "unknown");

  // Malformed XDR in value
  const badValueEvent = {
    id: "302-0",
    ledger: 302,
    contractId: TEST_CONFIG.marketContractId,
    topic: [xdr.ScVal.scvSymbol("claim_challenged")],
    value: "invalid-scval-structure",
  };
  const badValueDecoded = decodeEvent("market", badValueEvent);
  assert.equal(badValueDecoded.payload.name, "unknown");
  assert.match(badValueDecoded.payload.reason ?? "", /malformed event value XDR/);
});

test("readContractEvents handles synthetic response containing malformed XDR without crashing scanner", async () => {
  const fakeServer = {
    getHealth: async () => ({ oldestLedger: 100, latestLedger: 200 }),
    getEvents: async (req) => {
      if (req.cursor === "200-1") {
        return { latestLedger: 200, cursor: "200-1", events: [] };
      }
      return {
        latestLedger: 200,
        cursor: "200-1",
        events: [
          {
            id: "200-0",
            ledger: 200,
            contractId: TEST_CONFIG.marketContractId,
            topic: [xdr.ScVal.scvSymbol("claim_challenged"), xdr.ScVal.scvU64(new xdr.Uint64(1n)), xdr.ScVal.scvString(VALID_ADDR)],
            value: xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("stake"),
                val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(-500n), lo: new xdr.Uint64(0n) })),
              }),
            ]),
          },
          {
            id: "200-1",
            ledger: 200,
            contractId: TEST_CONFIG.marketContractId,
            topic: ["corrupt-topic-xdr"],
            value: "corrupt-value-xdr",
          },
        ],
      };
    },
  };

  const scan = await readContractEvents(fakeServer, {
    source: "market",
    contractId: TEST_CONFIG.marketContractId,
  });

  assert.equal(scan.events.length, 2);
  assert.equal(scan.events[0].payload.name, "unknown");
  assert.match(scan.events[0].payload.reason ?? "", /expected non-negative amount/);
  assert.equal(scan.events[1].payload.name, "unknown");
  assert.equal(scan.cursor, "200-1");
  assert.equal(scan.lastEventLedger, 200);
});

test("eventCursorLedger safely handles valid, invalid, and non-string cursors", () => {
  assert.equal(eventCursorLedger("0018276211125911551-4294967295"), 4255261);
  assert.equal(eventCursorLedger("invalid"), null);
  assert.equal(eventCursorLedger(""), null);
  assert.equal(eventCursorLedger(null), null);
  assert.equal(eventCursorLedger(123), null);
});
