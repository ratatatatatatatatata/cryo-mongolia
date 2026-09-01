import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256File } from "./hash.mjs";
import { assertReadableFile } from "./output-policy.mjs";

export class WorkbookReadError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkbookReadError";
    this.code = code;
  }
}

async function loadArtifactTool(moduleRoot = process.env.OAI_ARTIFACT_TOOL_NODE_MODULES) {
  try {
    return await import("@oai/artifact-tool");
  } catch {
    if (!moduleRoot) throw new WorkbookReadError("artifact_tool_unavailable");
  }

  try {
    const resolver = createRequire(pathToFileURL(join(resolve(moduleRoot), "__artifact_resolver__.cjs")));
    const entry = resolver.resolve("@oai/artifact-tool");
    return await import(pathToFileURL(entry).href);
  } catch {
    throw new WorkbookReadError("artifact_tool_unavailable");
  }
}

function parseSheetInspect(ndjson) {
  return ndjson
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readWorkbookSnapshot(workbookPath, { artifactModuleRoot } = {}) {
  await assertReadableFile(workbookPath);
  const fileSha256Before = await sha256File(workbookPath);

  try {
    const { FileBlob, SpreadsheetFile } = await loadArtifactTool(artifactModuleRoot);
    const input = await FileBlob.load(workbookPath);
    const workbook = await SpreadsheetFile.importXlsx(input);
    const inspected = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 50_000 });
    const sheetMetadata = parseSheetInspect(inspected.ndjson);
    const sheets = sheetMetadata.map((metadata) => {
      const sheet = workbook.worksheets.getItem(metadata.name);
      const range = sheet.getRange(metadata.address);
      return {
        index: metadata.index,
        name: metadata.name,
        address: metadata.address,
        values: range.values ?? [],
        formulas: range.formulas ?? [],
      };
    });
    const fileSha256After = await sha256File(workbookPath);
    if (fileSha256Before !== fileSha256After) throw new WorkbookReadError("workbook_changed_during_read");

    return {
      fileName: basename(workbookPath),
      fileSha256: fileSha256Before,
      sheets,
      reader: "@oai/artifact-tool",
    };
  } catch (error) {
    if (error instanceof WorkbookReadError) throw error;
    throw new WorkbookReadError("artifact_workbook_import_failed");
  }
}
