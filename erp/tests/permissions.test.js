import assert from "node:assert/strict";
import test from "node:test";
import { can, normalizeRole, visibleNavigation } from "../src/permissions.js";

test("role aliases and unknown roles normalize safely", () => {
  assert.equal(normalizeRole("administrator"), "admin");
  assert.equal(normalizeRole("therapist"), "therapist");
  assert.equal(normalizeRole("unexpected"), "viewer");
});

test("mutating UI actions follow backend role boundaries", () => {
  assert.equal(can("owner", "staff:invite"), true);
  assert.equal(can("manager", "staff:invite"), false);
  assert.equal(can("reception", "customers:create"), true);
  assert.equal(can("reception", "entitlements:consume"), true);
  assert.equal(can("therapist", "entitlements:consume"), true);
  assert.equal(can("viewer", "entitlements:consume"), false);
  assert.equal(can("accountant", "customers:edit"), false);
  assert.equal(can("accountant", "customers:view"), false);
  assert.equal(can("auditor", "customers:view"), false);
  assert.equal(can("therapist", "payments:view"), false);
  assert.equal(can("reception", "payments:view"), true);
});

test("navigation hides the staff screen when the role cannot select it", () => {
  assert.deepEqual(visibleNavigation("viewer"), []);
  assert.equal(visibleNavigation("auditor").some((item) => item.href === "#/staff"), true);
});
