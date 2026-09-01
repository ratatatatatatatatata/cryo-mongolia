import assert from "node:assert/strict";
import test from "node:test";
import { materializeMappedRows } from "../lib/pipeline.mjs";

const FILE_HASH = "d".repeat(64);
const SYNTHETIC_PHONE = ["88", "11", "22", "33"].join("");
const SECOND_SYNTHETIC_PHONE = ["99", "11", "22", "33"].join("");

test("local materialization imports valid rows, quarantines ambiguity, and reconciles counts", () => {
  const snapshot = {
    fileSha256: FILE_HASH,
    sheets: [{
      index: 0,
      values: [
        ["Date", "Phone", "Service", "Amount"],
        [45_000, `+976 ${SYNTHETIC_PHONE}`, "Synthetic Service", 1000],
        ["05/06/2026", `${SYNTHETIC_PHONE} / ${SECOND_SYNTHETIC_PHONE}`, "Synthetic Service", "1000,50"],
        ["TOTAL", null, null, 2000],
      ],
      formulas: [[], [], [], []],
    }],
  };
  const mapping = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [{
        segmentId: "sheet-0-table-1",
        startRow: 1,
        endRow: 4,
        disposition: "import",
        entity: "sales",
        mode: "rows",
        columns: {
          transactionDate: { index: 0, parser: "date", textOrder: "DMY", required: true },
          customerPhone: { index: 1, parser: "phone", required: true },
          service: { index: 2, parser: "service", required: true },
          amount: { index: 3, parser: "amount", currency: "MNT", maxScale: 0, required: true },
        },
      }],
    }],
  };

  const result = materializeMappedRows(snapshot, mapping);
  assert.equal(result.records.length, 1);
  assert.equal(result.quarantine.length, 1);
  assert.equal(result.reconciliation.status, "pass");
  assert.deepEqual(result.reconciliation.counts, { eligible: 4, imported: 1, quarantined: 1, ignored: 2 });
  assert.deepEqual(result.sourceRows, { eligible: 4, imported: 1, quarantined: 1, ignored: 2 });
  assert.equal(result.records[0].fields.serviceCanonical, "synthetic service");
});

test("two mini-tables on one sheet use independent explicit mappings", () => {
  const snapshot = {
    fileSha256: FILE_HASH,
    sheets: [{
      index: 0,
      values: [
        ["Service", "Amount"],
        ["Synthetic A", 100],
        [null, null],
        ["Amount", "Service"],
        [200, "Synthetic B"],
      ],
      formulas: [[], [], [], [], []],
    }],
  };
  const mapping = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [
        {
          segmentId: "first-table",
          startRow: 1,
          endRow: 2,
          disposition: "import",
          entity: "sales",
          mode: "rows",
          columns: {
            service: { index: 0, parser: "service", required: true },
            amount: { index: 1, parser: "amount", required: true },
          },
        },
        {
          segmentId: "blank-separator",
          startRow: 3,
          endRow: 3,
          disposition: "skip",
          reason: "verified_blank_rows_only",
        },
        {
          segmentId: "second-table",
          startRow: 4,
          endRow: 5,
          disposition: "import",
          entity: "sales",
          mode: "rows",
          columns: {
            amount: { index: 0, parser: "amount", required: true },
            service: { index: 1, parser: "service", required: true },
          },
        },
      ],
    }],
  };

  const result = materializeMappedRows(snapshot, mapping);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.fields.amount), ["100", "200"]);
  assert.deepEqual(result.reconciliation.counts, { eligible: 5, imported: 2, quarantined: 0, ignored: 3 });
});

test("wide package reconciliation counts source rows, not unpivoted records", () => {
  const snapshot = {
    fileSha256: FILE_HASH,
    sheets: [{
      index: 0,
      values: [
        ["Customer", "Package", "Use 1", "Use 2"],
        ["Synthetic C", "Synthetic P", 45_000, 45_001],
        ["Synthetic D", "Synthetic P", 45_002, "invalid-date"],
      ],
      formulas: [[], [], []],
    }],
  };
  const mapping = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [{
        segmentId: "wide-table",
        startRow: 1,
        endRow: 3,
        disposition: "import",
        entity: "package_redemptions",
        mode: "wide_package",
        headerRow: 1,
        dataStartRow: 2,
        identityColumns: { customerRef: 0, packageRef: 1 },
        usageColumns: [
          { columnIndex: 2, parser: "date", targetField: "usedAt" },
          { columnIndex: 3, parser: "date", targetField: "usedAt" },
        ],
      }],
    }],
  };

  const result = materializeMappedRows(snapshot, mapping);
  assert.equal(result.records.length, 2);
  assert.equal(result.quarantine.length, 1);
  assert.deepEqual(result.sourceRows, { eligible: 3, imported: 1, quarantined: 1, ignored: 1 });
  assert.equal(result.reconciliation.status, "pass");
});
