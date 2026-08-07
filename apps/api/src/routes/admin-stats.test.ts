import assert from "node:assert/strict";
import test from "node:test";
import { EARLIEST_STATS_TIMESTAMP, safeCalculatedIso, safeDateOffsetIso } from "./admin-stats.js";

test("uses a valid epoch timestamp as the earliest stats boundary", () => {
  assert.equal(EARLIEST_STATS_TIMESTAMP, "1970-01-01T00:00:00.000Z");
});

test("calculated ISO serialization rejects timestamps outside the JavaScript Date range", () => {
  assert.equal(safeCalculatedIso(Date.now() - Number.MAX_SAFE_INTEGER), null);
  assert.equal(safeCalculatedIso(Number.NaN), null);
});

test("date offset serialization does not throw for malformed stored dates", () => {
  assert.equal(safeDateOffsetIso("not-a-date", 5 * 60 * 60 * 1000), null);
  assert.equal(
    safeDateOffsetIso("2026-08-03T00:29:12.000Z", 5 * 60 * 60 * 1000),
    "2026-08-03T05:29:12.000Z"
  );
});
