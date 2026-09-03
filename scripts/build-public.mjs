import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");

const publicFiles = [
  "index.html",
  "index.css",
  "index.js",
  "logo.svg",
  "shared.css",
  "cryo3d.js",
  "data.js",
  "auth.js",
  "admin.html",
  "admin.css",
  "admin.js",
  "cabin.html",
  "hub.html",
  "ledpro.html",
  "oxypro.html",
  "xcryo.html",
  "supabase-config.js",
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const relativePath of publicFiles) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Required public file is missing: ${relativePath}`);
  }
  fs.copyFileSync(source, path.join(output, relativePath));
}

fs.cpSync(path.join(root, "photos"), path.join(output, "photos"), {
  recursive: true,
  filter(source) {
    return fs.statSync(source).isDirectory() || source.toLowerCase().endsWith(".png");
  },
});

const forbidden = [
  "supabase",
  "scripts",
  ".git",
  ".github",
  ".private-backup",
  "node_modules",
];

for (const relativePath of forbidden) {
  if (fs.existsSync(path.join(output, relativePath))) {
    throw new Error(`Forbidden path reached public output: ${relativePath}`);
  }
}

console.log(`[build-public] staged ${publicFiles.length} files and public images only`);
