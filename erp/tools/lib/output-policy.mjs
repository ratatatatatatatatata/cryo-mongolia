import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";

export class OutputPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "OutputPolicyError";
    this.code = code;
  }
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function assertSafeOutputDirectory({ outputDir, repoRoot, explicit = false }) {
  const resolvedOutput = resolve(outputDir);
  const resolvedRepo = resolve(repoRoot);
  if (resolvedOutput === parse(resolvedOutput).root || resolvedOutput === resolve(homedir())) {
    throw new OutputPolicyError("broad_output_path_rejected");
  }

  if (inside(resolvedRepo, resolvedOutput)) {
    const relativeOutput = relative(resolvedRepo, resolvedOutput);
    const ignored = spawnSync("git", ["-C", resolvedRepo, "check-ignore", "-q", "--", relativeOutput], {
      stdio: "ignore",
    });
    if (ignored.status !== 0) throw new OutputPolicyError("repository_output_path_is_not_ignored");
  } else if (!explicit) {
    throw new OutputPolicyError("external_output_path_must_be_explicit");
  }

  return resolvedOutput;
}

export async function prepareOutputDirectory(options) {
  const outputDir = assertSafeOutputDirectory(options);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  return outputDir;
}

export async function writeNewJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function writeNewJsonLines(filePath, values) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const content = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(filePath, content ? `${content}\n` : "", { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function assertReadableFile(filePath) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new OutputPolicyError("input_file_not_readable");
  }
}
