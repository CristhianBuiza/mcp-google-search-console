import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, mapRows, resolveDateRange } from "../util.js";
import { loadConfig, SCOPE_FULL, SCOPE_READONLY } from "../config.js";

test("resolveDateRange defaults to 28 days ending 2 days ago", () => {
  const r = resolveDateRange({}, new Date("2026-11-08T12:00:00Z"));
  assert.deepEqual(r, { startDate: "2026-10-10", endDate: "2026-11-06" });
});

test("resolveDateRange honours days and explicit dates", () => {
  assert.deepEqual(resolveDateRange({ endDate: "2026-01-31", days: 7 }), { startDate: "2026-01-25", endDate: "2026-01-31" });
  assert.throws(() => resolveDateRange({ startDate: "2026-02-01", endDate: "2026-01-01" }));
});

test("mapRows names dimensions", () => {
  const rows = mapRows([{ keys: ["foo", "esp"], clicks: 3, impressions: 10, ctr: 0.30001, position: 2.456 }], ["query", "country"]);
  assert.deepEqual(rows, [{ query: "foo", country: "esp", clicks: 3, impressions: 10, ctr: 0.3, position: 2.46 }]);
});

test("errorMessage surfaces Google API errors", () => {
  const msg = errorMessage({ response: { status: 403, data: { error: { message: "User does not have sufficient permission" } } } });
  assert.match(msg, /sufficient permission/);
  assert.match(msg, /403/);
});

test("loadConfig scopes and validation", () => {
  assert.throws(() => loadConfig({}), /Missing OAuth client/);
  assert.deepEqual(loadConfig({ GSC_CLIENT_ID: "a", GSC_CLIENT_SECRET: "b" }).scopes, [SCOPE_FULL]);
  assert.deepEqual(loadConfig({ GSC_CLIENT_ID: "a", GSC_CLIENT_SECRET: "b", GSC_READONLY: "true" }).scopes, [SCOPE_READONLY]);
});
