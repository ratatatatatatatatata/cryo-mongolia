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
    if (fs.statSync(source).isDirectory()) return true;
    return /\.(png|webp|jpe?g)$/i.test(source);
  },
});

// Keep the source page simple, but stage the supplied ZeroBody device image
// into the production treatment card during the public build.
const indexPath = path.join(output, "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");
const zerobodyBefore = `<div class="treatment-card active-card" data-svc="zerobody" data-cat="relax" data-tilt="7">\n      <div class="card-visual"></div>`;
const zerobodyAfter = `<div class="treatment-card active-card" data-svc="zerobody" data-cat="relax" data-tilt="7">\n      <div class="card-visual zerobody-visual"><img src="photos/img-zerobody.webp" alt="ZeroBody™ — Хуурай хөвөх" loading="lazy"/></div>`;
if (!indexHtml.includes(zerobodyBefore)) {
  throw new Error("ZeroBody treatment card marker was not found in index.html");
}
indexHtml = indexHtml.replace(zerobodyBefore, zerobodyAfter);
fs.writeFileSync(indexPath, indexHtml);

// The supplied ZeroBody asset has a transparent background. Treat it as a
// device/product image instead of cropping it like the lifestyle photos.
const indexCssPath = path.join(output, "index.css");
fs.appendFileSync(
  indexCssPath,
  `\n\n/* ZeroBody treatment device image */\n.treatment-card[data-svc="zerobody"] .card-visual{\n  background:\n    radial-gradient(80% 95% at 50% 100%,rgba(88,198,255,.28),transparent 64%),\n    linear-gradient(150deg,rgba(24,49,79,.82),rgba(8,16,28,.96));\n}\n.treatment-card[data-svc="zerobody"] .card-visual img{\n  inset:8px 14px 6px;\n  width:calc(100% - 28px);\n  height:calc(100% - 14px);\n  object-fit:contain;\n  object-position:center;\n  opacity:.96;\n  filter:drop-shadow(0 18px 24px rgba(0,0,0,.48)) saturate(.95) contrast(1.03);\n}\n.treatment-card[data-svc="zerobody"] .card-visual::after{\n  background:linear-gradient(to bottom,transparent 58%,rgba(8,16,28,.56));\n}\n.treatment-card[data-svc="zerobody"]:hover .card-visual img{\n  transform:scale(1.035);\n  opacity:1;\n}\n`,
);

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
