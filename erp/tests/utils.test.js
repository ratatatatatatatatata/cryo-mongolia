import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDate,
  escapeHtml,
  formatDate,
  fullName,
  maskPhone,
  remainingCount,
  zonedLocalDateTimeToIso,
} from "../src/utils.js";

test("HTML output escapes adapter-provided values", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("customer helpers handle missing and exhausted values", () => {
  assert.equal(fullName({ lastName: "Жишээ", firstName: "Хүн" }), "Жишээ Хүн");
  assert.equal(maskPhone("99000001"), "99•• ••01");
  assert.equal(remainingCount({ totalCount: 5, usedCount: 7 }), 0);
});

test("business date follows Ulaanbaatar day at the UTC boundary", () => {
  assert.equal(businessDate(new Date("2026-09-01T15:59:59.000Z")), "2026-09-01");
  assert.equal(businessDate(new Date("2026-09-01T16:00:00.000Z")), "2026-09-02");
});

test("display date is deterministic and uses Ulaanbaatar time", () => {
  assert.equal(formatDate("2026-08-29T03:15:00.000Z"), "2026.08.29");
  assert.equal(
    formatDate("2026-08-29T03:15:00.000Z", { hour: "2-digit", minute: "2-digit" }),
    "2026.08.29 11:15",
  );
  assert.equal(formatDate("not-a-date"), "—");
});

test("Ulaanbaatar local package time converts to a deterministic UTC instant", () => {
  assert.equal(zonedLocalDateTimeToIso("2026-09-01T00:30"), "2026-08-31T16:30:00.000Z");
  assert.equal(zonedLocalDateTimeToIso("2026-02-30T10:00"), null);
  assert.equal(zonedLocalDateTimeToIso("not-a-date"), null);
});
