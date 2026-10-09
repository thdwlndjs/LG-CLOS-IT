import { test } from "node:test";
import assert from "node:assert/strict";
import { monthBounds } from "../src/calendar.js";
test("calendar covers leap February and weekday offset", () =>
  assert.deepEqual(monthBounds("2024-02"), {
    from: "2024-02-01",
    to: "2024-02-29",
    leading: 4,
  }));
test("calendar covers December boundary", () =>
  assert.equal(monthBounds("2026-12").to, "2026-12-31"));
test("invalid month is rejected", () => {
  assert.throws(() => monthBounds("2026-13"));
  assert.throws(() => monthBounds("2026-1"));
});
