#!/usr/bin/env node
import { resolve } from "node:path";
import {
  approveDryRun,
  applyApprovedLocally,
  loadMappingFile,
  runContentAwareMapping,
  runDraftMapping,
  runDryRun,
} from "./lib/pipeline.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const defaultOutput = resolve(import.meta.dirname, "../.private-import");

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error("unexpected_positional_argument");
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value_for_${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key]) throw new Error(`missing_${key}`);
  return options[key];
}

function outputOptions(options) {
  return {
    outputDir: resolve(options.output ?? defaultOutput),
    repoRoot,
    explicitOutput: Boolean(options.output),
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "content-mapping") {
    const result = await runContentAwareMapping({
      workbookPath: resolve(required(options, "workbook")),
      artifactModuleRoot: process.env.OAI_ARTIFACT_TOOL_NODE_MODULES,
      ...outputOptions(options),
    });
    console.log(JSON.stringify({
      state: "content_mapping_created",
      file: result.destination.split("/").at(-1),
      workbookSha256Prefix: result.mapping.workbookSha256.slice(0, 12),
      sheets: result.mapping.sheets.length,
      segments: result.summary.segments,
      rows: result.summary.rows,
      reviewClasses: result.summary.reviewClasses,
      importEntities: result.summary.importEntities,
    }));
    return;
  }

  if (command === "draft-mapping") {
    const result = await runDraftMapping({
      workbookPath: resolve(required(options, "workbook")),
      artifactModuleRoot: process.env.OAI_ARTIFACT_TOOL_NODE_MODULES,
      ...outputOptions(options),
    });
    console.log(JSON.stringify({
      state: "draft_mapping_created",
      file: result.destination.split("/").at(-1),
      workbookSha256Prefix: result.mapping.workbookSha256.slice(0, 12),
      sheets: result.mapping.sheets.length,
      segments: result.summary,
    }));
    return;
  }

  if (command === "dry-run") {
    const mapping = options.mapping ? await loadMappingFile(resolve(options.mapping)) : null;
    const result = await runDryRun({
      workbookPath: resolve(required(options, "workbook")),
      mapping,
      artifactModuleRoot: process.env.OAI_ARTIFACT_TOOL_NODE_MODULES,
      ...outputOptions(options),
    });
    console.log(JSON.stringify({
      state: result.manifest.readyForApproval ? "review_ready" : "review_required",
      file: result.destination.split("/").at(-1),
      workbookSha256Prefix: result.manifest.source.fileSha256.slice(0, 12),
      sheets: result.manifest.source.sheetCount,
      blockingIssues: result.manifest.blockingIssues.length,
    }));
    return;
  }

  if (command === "approve") {
    const result = await approveDryRun({
      manifestPath: resolve(required(options, "manifest")),
      confirmManifestId: required(options, "confirm"),
      ...outputOptions(options),
    });
    console.log(JSON.stringify({ state: "approved_for_local_apply", file: result.destination.split("/").at(-1) }));
    return;
  }

  if (command === "apply") {
    const mapping = await loadMappingFile(resolve(required(options, "mapping")));
    const result = await applyApprovedLocally({
      workbookPath: resolve(required(options, "workbook")),
      mapping,
      manifestPath: resolve(required(options, "manifest")),
      approvalPath: resolve(required(options, "approval")),
      artifactModuleRoot: process.env.OAI_ARTIFACT_TOOL_NODE_MODULES,
      ...outputOptions(options),
    });
    console.log(JSON.stringify({ state: "local_private_materialization_complete", ...result }));
    return;
  }

  throw new Error("command_must_be_content_mapping_draft_mapping_dry_run_approve_or_apply");
}

main().catch((error) => {
  const code = error?.code ?? (typeof error?.message === "string" && /^[a-z0-9_]+$/.test(error.message) ? error.message : "unexpected_failure");
  console.error(JSON.stringify({ state: "failed_closed", code }));
  process.exitCode = 1;
});
