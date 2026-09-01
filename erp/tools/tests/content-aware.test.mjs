import assert from "node:assert/strict";
import test from "node:test";
import { buildContentAwareMapping, summarizeContentAwareMapping } from "../lib/content-aware-mapping.mjs";
import { validateMapping } from "../lib/mapping.mjs";
import { materializeMappedRows } from "../lib/pipeline.mjs";

const FILE_HASH = "e".repeat(64);
const SYNTHETIC_PHONE = ["88", "11", "22", "33"].join("");

function sheet(index, name, values) {
  return { index, name, address: "A1:Z100", values, formulas: values.map(() => []) };
}

test("content-aware mapping imports only high-confidence MVP sections and explicitly reviews the rest", () => {
  const snapshot = {
    fileName: "legacy.xlsx",
    fileSha256: FILE_HASH,
    reader: "@oai/artifact-tool",
    sheets: [
      sheet(0, "Contacts", [
        ["Customer name", "Phone"],
        ["PRIVATE CUSTOMER", `+976 ${SYNTHETIC_PHONE}`],
      ]),
      sheet(1, "Price list", [
        ["Service"],
        [null],
        ["Option Alpha"],
        ["Option Beta"],
        ["Option Gamma"],
      ]),
      sheet(2, "Package", [
        ["Customer name", "Package", "Date", "Use 1", "Use 2"],
        ["PRIVATE CUSTOMER", "PRIVATE PACKAGE", 45_000, 45_001, 45_002],
      ]),
      sheet(3, "Income", [
        ["Date", "Amount"],
        [45_000, 999_999],
      ]),
    ],
  };

  const mapping = buildContentAwareMapping(snapshot);
  const validation = validateMapping(mapping, {
    workbookSha256: FILE_HASH,
    sheetCount: snapshot.sheets.length,
    sheetRowCounts: snapshot.sheets.map((entry) => entry.values.length),
  });
  assert.equal(validation.structurallyValid, true);
  assert.equal(validation.valid, false);

  const summary = summarizeContentAwareMapping(mapping);
  assert.deepEqual(summary.importEntities, { customers: 1, services: 1 });
  assert.equal(summary.reviewReasons.mvp_package_entitlement_quantity_review_required, 1);
  assert.equal(summary.reviewReasons.deferred_finance_sales_out_of_mvp, 1);

  const serialized = JSON.stringify(mapping);
  for (const rawValue of ["PRIVATE CUSTOMER", `+976 ${SYNTHETIC_PHONE}`, "PRIVATE PACKAGE", "Option Alpha", "999999"]) {
    assert.equal(serialized.includes(rawValue), false);
  }

  const preview = materializeMappedRows(snapshot, mapping, { deferReviewSegments: true });
  assert.equal(preview.reconciliation.status, "pass");
  assert.equal(preview.sourceRows.imported, 4);
  assert.equal(preview.sourceRows.deferred > 0, true);
  assert.equal(preview.recordsMaterialized, 4);
});
