import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_ADAPTER_METHODS, validateAdapter } from "../src/api/contract.js";

test("adapter contract reports every missing method", () => {
  const invalid = validateAdapter({ getSession() {} });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.missing.includes("getSession"), false);
  assert.equal(invalid.missing.includes("consumeEntitlement"), true);

  const complete = Object.fromEntries(REQUIRED_ADAPTER_METHODS.map((method) => [method, () => {}]));
  assert.deepEqual(validateAdapter(complete), { valid: true, missing: [] });
});

