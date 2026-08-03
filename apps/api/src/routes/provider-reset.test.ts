import assert from "node:assert/strict";
import test from "node:test";
import { isProviderResetActive, parseProviderResetAt } from "./provider-reset.js";

test("parses Z.AI's exact five-hour reset and keeps the incident active", () => {
  const message = "Usage limit reached for 5 hour. Your limit will reset at 2026-08-03 05:29:12";
  const resetAt = parseProviderResetAt(message);
  assert.equal(resetAt, "2026-08-03T05:29:12.000Z");
  assert.equal(isProviderResetActive(resetAt, new Date("2026-08-03T05:00:00Z")), true);
  assert.equal(isProviderResetActive(resetAt, new Date("2026-08-03T05:30:00Z")), false);
});

test("ignores unrelated provider errors", () => {
  assert.equal(parseProviderResetAt("429 Too Many Requests"), null);
});
