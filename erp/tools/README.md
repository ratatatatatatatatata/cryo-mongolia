# CRYO legacy workbook import tools

One-time, fail-closed tooling for reviewing and locally materializing a legacy Excel workbook before a separate ERP import. The tools never modify the workbook and contain no database, Supabase, HTTP, or other network writer.

## Safety boundary

- `@oai/artifact-tool` is the primary and only workbook reader.
- No customer, employee, phone, or amount values are printed by `dry-run`.
- `approve` binds an exact workbook SHA-256, mapping SHA-256, and review manifest ID.
- `apply` only writes private local JSON/JSONL files. It does **not** write to a database or network.
- Output files use create-only writes (`wx`); an existing file is never overwritten.
- A path inside the repository is accepted only when Git confirms it is ignored.
- Mapping version 2 requires explicit, ordered, non-overlapping segments that cover every used row of every sheet. A gap, overlap, missing sheet, or unresolved `review` segment blocks approval.
- Ambiguous phones, dates, amounts, required fields, and unapproved wide-package layouts are quarantined or rejected. They are never silently coerced.
- Duplicate and service-alias results are candidates for human review; no automatic merge occurs.

## Runtime

Node.js 22 or later is required. Make `@oai/artifact-tool` available either as a normal installed/managed dependency or through the bundled-runtime path returned by the workspace dependency loader:

```sh
export OAI_ARTIFACT_TOOL_NODE_MODULES="/path/from/workspace-loader/node_modules"
```

Do not install an arbitrary alternate spreadsheet package as a fallback. If Artifact Tool is unavailable or cannot read the workbook, the command fails closed with a sanitized error code.

## Private output policy

The default output is `erp/.private-import/`. It is usable only while Git confirms this exact directory is ignored:

```gitignore
erp/.private-import/
```

If the ignore rule is absent, pass an explicit output directory outside the repository, such as an access-controlled temporary or encrypted folder. The CLI rejects any repository output path that Git does not confirm as ignored.

Never commit files produced by this pipeline. Private outputs may contain source values after the approved local `apply` stage.

## Four separate gates

### 1. Generate a private draft mapping

Artifact Tool can create a sanitized mapping draft without writing raw cell values into the mapping. Blank-only row runs become explicit skips. Every content section remains `review`, including repeated mini-table headers and wide package layouts:

```sh
node erp/tools/cli.mjs draft-mapping \
  --workbook "/secure/path/legacy.xlsx"
```

The draft is deliberately not approvable. Review each segment, replace `review` with an evidenced `import` or `skip` decision, configure its parser columns, and set the top-level mapping status to `reviewed`. Do not remove segments: their ranges must still cover every used row exactly once.

For the current CRYO ERP MVP, generate a stricter content-aware private mapping instead:

```sh
node erp/tools/cli.mjs content-mapping \
  --workbook "/secure/path/legacy.xlsx"
```

This command reviews every detected content segment using fixed semantic and data-quality rules. It automatically marks only high-confidence customer name/phone and service-name sections as `import`. Package, entitlement, session, and staff sections remain explicit `review` when identity, entitlement quantity, authentication linkage, or layout is not sufficiently evidenced. Finance, payroll, partner, inventory, barter, and expense sections receive explicit deferred reason codes; they are never silently skipped.

### 2. Dry-run

Without a reviewed mapping, this always emits a sanitized review manifest and remains blocked for approval:

```sh
node erp/tools/cli.mjs dry-run \
  --workbook "/secure/path/legacy.xlsx" \
  --output "/secure/private/cryo-import-review"
```

Review the sheet categories, header candidates, row roles, ambiguities, duplicate candidates, wide-package warnings, and reconciliation requirements. No raw cell values are included in this manifest.

When a structurally valid mapping contains unresolved review segments, the dry-run also includes a sanitized `contentAwarePreview`. It reconciles imported, quarantined, ignored, and deferred source-row counts without writing normalized records or raw values to the manifest.

Start from the private draft or `mapping.example.json`. Every workbook sheet must have exactly one profile, and its ordered segments must cover all rows with an explicit `import` or documented `skip` disposition. Different mini-tables in one sheet can use different column mappings. Re-run dry-run with that exact mapping:

```sh
node erp/tools/cli.mjs dry-run \
  --workbook "/secure/path/legacy.xlsx" \
  --mapping "/secure/path/approved-mapping.json" \
  --output "/secure/private/cryo-import-review"
```

For a package cross-tab, use `mode: "wide_package"` and explicitly list identity and usage columns. Blank usage cells are not zero, and package redemptions must not be treated as new revenue.

### 3. Approve

Approval requires copying the complete manifest ID from the reviewed manifest. It does not authorize a production write:

```sh
node erp/tools/cli.mjs approve \
  --manifest "/secure/private/cryo-import-review/review-....json" \
  --confirm "FULL_MANIFEST_ID" \
  --output "/secure/private/cryo-import-review"
```

If the workbook or mapping changes, all hashes change and the approval becomes unusable.

### 4. Apply locally

This stage materializes private local files only:

```sh
node erp/tools/cli.mjs apply \
  --workbook "/secure/path/legacy.xlsx" \
  --mapping "/secure/path/approved-mapping.json" \
  --manifest "/secure/private/cryo-import-review/review-....json" \
  --approval "/secure/private/cryo-import-review/approval-....json" \
  --output "/secure/private/cryo-import-output"
```

Generated files:

- `normalized-*.jsonl` — locally parsed records with immutable source keys.
- `quarantine-*.jsonl` — ambiguous or invalid records and their review reasons.
- `reconciliation-*.json` — row-accounting and configured balance checks.

For a wide-package segment, reconciliation counts source rows separately from the number of unpivoted records. If any populated usage cell in a source row is invalid, that source row is quarantined as one unit and none of its usage records are emitted.

A later, separately reviewed database loader must consume these files. This package intentionally provides no production writer.

## Deterministic source identity

Every source record/cell key is:

```text
<workbook-sha256>:<zero-based-sheet-index>:<one-based-row>:<A1-cell-or-dash>
```

Customer identity should use an encrypted normalized phone plus a secret-key HMAC in the ERP. A display name must never be used as the sole deduplication key.

## Tests

```sh
cd erp/tools
node --test ./tests/*.test.mjs
```

Tests use synthetic values only and perform no database or network operations.
