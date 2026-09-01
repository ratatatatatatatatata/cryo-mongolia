import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoots = [join(root, "src"), join(root, "scripts"), join(root, "tests")];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    if (entry.isFile()) files.push(path);
  }

  return files;
}

const files = (await Promise.all(sourceRoots.map(walk))).flat();
const javascriptFiles = files.filter((file) => [".js", ".mjs"].includes(extname(file)));

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

const textFiles = [
  ...files,
  join(root, "index.html"),
  join(root, "runtime-config.js"),
  join(root, "assets", "erp.css"),
  join(root, "package.json"),
];
const forbidden = [
  new RegExp(`${["sb", "secret"].join("_")}_[A-Za-z0-9_-]+`, "g"),
  /service[_-]?role\s*[:=]\s*["'][^"']+/gi,
  new RegExp(`${"-----BEGIN"} (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`, "g"),
];

for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      console.error(`Хориглосон нууцын хэв маяг илэрлээ: ${relative(root, file)}`);
      process.exit(1);
    }
    pattern.lastIndex = 0;
  }
}

const html = await readFile(join(root, "index.html"), "utf8");
for (const expected of ["./assets/erp.css", "./runtime-config.js", "./assets/app.js", "id=\"app\""]) {
  if (!html.includes(expected)) {
    console.error(`index.html шаардлагатай холбоосгүй байна: ${expected}`);
    process.exit(1);
  }
}

if (/https:\/\/\*\.supabase\.co|wss:\/\/\*\.supabase\.co/.test(html)) {
  console.error("CSP-д бүх Supabase project-ийг зөвшөөрсөн wildcard ашиглахгүй. Exact project origin оруулна уу.");
  process.exit(1);
}

const runtimeConfig = await readFile(join(root, "runtime-config.js"), "utf8");
const configuredUrl = runtimeConfig.match(/supabaseUrl:\s*["'](https:\/\/[^"']+\.supabase\.co)["']/)?.[1];
if (configuredUrl) {
  const configuredOrigin = new URL(configuredUrl).origin;
  const websocketOrigin = configuredOrigin.replace("https://", "wss://");
  for (const origin of [configuredOrigin, websocketOrigin]) {
    if (!html.includes(origin)) {
      console.error(`Runtime Supabase URL тохируулсан боловч CSP exact origin дутуу: ${origin}`);
      process.exit(1);
    }
  }
}

console.log(`Static check passed: ${javascriptFiles.length} JavaScript module.`);
