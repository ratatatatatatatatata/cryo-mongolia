import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWorkbookSnapshot } from "../lib/analyze.mjs";
import { buildDraftMapping, summarizeMappingSegments } from "../lib/draft-mapping.mjs";
import { validateMapping } from "../lib/mapping.mjs";

const FILE_HASH = "c".repeat(64);
const SYNTHETIC_PHONE = ["88", "11", "22", "33"].join("");

test("review manifest is sanitized and approval depends on mapping", () => {
  const snapshot = {
    fileName: "legacy.xlsx",
    fileSha256: FILE_HASH,
    reader: "@oai/artifact-tool",
    sheets: [{
      index: 0,
      name: "Sensitive employee label",
      address: "A1:D3",
      values: [
        ["Customer name", "Phone", "Service", "Amount"],
        ["SENSITIVE CUSTOMER", `+976 ${SYNTHETIC_PHONE}`, "PRIVATE SERVICE", 123456],
        ["SENSITIVE CUSTOMER", `+976 ${SYNTHETIC_PHONE}`, "PRIVATE SERVICE", 123456],
      ],
      formulas: [[], [], []],
    }],
  };
  const unmapped = analyzeWorkbookSnapshot(snapshot);
  assert.equal(unmapped.readyForApproval, false);
  assert.equal(unmapped.privacy.rawCellValuesIncluded, false);
  const serialized = JSON.stringify(unmapped);
  for (const secret of ["Sensitive employee label", "SENSITIVE CUSTOMER", `+976 ${SYNTHETIC_PHONE}`, "PRIVATE SERVICE", "123456"]) {
    assert.equal(serialized.includes(secret), false);
  }

  const mapping = {
    version: 2,
    status: "reviewed",
    workbookSha256: FILE_HASH,
    sheets: [{
      sheetIndex: 0,
      segments: [{
        segmentId: "sheet-0-reviewed-skip",
        startRow: 1,
        endRow: 3,
        disposition: "skip",
        reason: "reviewed_out_of_scope",
      }],
    }],
  };
  const mapped = analyzeWorkbookSnapshot(snapshot, { mapping });
  assert.equal(mapped.readyForApproval, true);
  assert.equal(mapped.mapping.valid, true);
});

test("draft mapping preserves repeated mini-table sections without exposing raw values", () => {
  const snapshot = {
    fileName: "legacy.xlsx",
    fileSha256: FILE_HASH,
    reader: "@oai/artifact-tool",
    sheets: [{
      index: 0,
      name: "Sensitive internal sheet label",
      address: "A1:C5",
      values: [
        ["Customer name", "Phone", "Amount"],
        ["PRIVATE PERSON ALPHA", `+976 ${SYNTHETIC_PHONE}`, 123456],
        ["Customer name", "Service", "Amount"],
        ["PRIVATE PERSON BETA", "PRIVATE SERVICE BETA", 654321],
        [null, null, null],
      ],
      formulas: [[], [], [], [], []],
    }],
  };

  const mapping = buildDraftMapping(snapshot);
  const summary = summarizeMappingSegments(mapping);
  assert.deepEqual(summary, { total: 3, import: 0, skip: 1, review: 2 });
  assert.deepEqual(mapping.sheets[0].segments.map(({ startRow, endRow }) => [startRow, endRow]), [[1, 2], [3, 4], [5, 5]]);
  const validation = validateMapping(mapping, {
    workbookSha256: FILE_HASH,
    sheetCount: 1,
    sheetRowCounts: [5],
  });
  assert.equal(validation.structurallyValid, true);
  assert.equal(validation.valid, false);

  const serialized = JSON.stringify(mapping);
  for (const secret of [
    "Sensitive internal sheet label",
    "PRIVATE PERSON ALPHA",
    "PRIVATE PERSON BETA",
    `+976 ${SYNTHETIC_PHONE}`,
    "PRIVATE SERVICE BETA",
    "123456",
    "654321",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});
