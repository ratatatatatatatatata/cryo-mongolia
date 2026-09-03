/* Rebuild logo.svg from the official logo PDF.

     npm i pdfjs-dist
     node scripts/build-logo.mjs <logo.pdf> [lightHex] [darkHex]

   Takes the symbol only (the wordmark is set in HTML), keeps the exact
   vector geometry, and recolours it: the PDF renders through a duller
   profile than the brand blues sampled from the official PNG. */
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";

const PDF = process.argv[2] || "E:/download/fwdcryomongolialogo/logo_file.pdf";
const OUT = new URL("../logo.svg", import.meta.url).pathname.replace(/^//, "");

/* colours read off cryo-mongolia-symbol.png */
const LIGHT = process.argv[3] || "#69ADFF";
const DARK  = process.argv[4] || "#0069EA";

const data = new Uint8Array(fs.readFileSync(PDF));
const doc = await getDocument({ data }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const ops = await page.getOperatorList();

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
const mul = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

let ctm = [1, 0, 0, 1, 0, 0];
const stack = [];
let fill = [0, 0, 0];
let segs = [];
let pts = [];
const paths = [];

for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i];
  const a = ops.argsArray[i];

  if (fn === OPS.save) stack.push(ctm.slice());
  else if (fn === OPS.restore) ctm = stack.pop() || ctm;
  else if (fn === OPS.transform) {
    const [b0, b1, b2, b3, b4, b5] = a;
    const m = ctm;
    ctm = [
      m[0] * b0 + m[2] * b1, m[1] * b0 + m[3] * b1,
      m[0] * b2 + m[2] * b3, m[1] * b2 + m[3] * b3,
      m[0] * b4 + m[2] * b5 + m[4], m[1] * b4 + m[3] * b5 + m[5],
    ];
  } else if (fn === OPS.setFillRGBColor) fill = Array.from(a);
  else if (fn === OPS.constructPath) {
    const [fns, coords] = a;
    let c = 0;
    for (const op of fns) {
      if (op === OPS.moveTo) {
        const p = mul(ctm, coords[c++], coords[c++]);
        segs.push("M " + fmt(p[0]) + " " + fmt(p[1]));
        pts.push(p);
      } else if (op === OPS.lineTo) {
        const p = mul(ctm, coords[c++], coords[c++]);
        segs.push("L " + fmt(p[0]) + " " + fmt(p[1]));
        pts.push(p);
      } else if (op === OPS.curveTo) {
        const p1 = mul(ctm, coords[c++], coords[c++]);
        const p2 = mul(ctm, coords[c++], coords[c++]);
        const p3 = mul(ctm, coords[c++], coords[c++]);
        segs.push("C " + fmt(p1[0]) + " " + fmt(p1[1]) + " " + fmt(p2[0]) + " " + fmt(p2[1]) +
                  " " + fmt(p3[0]) + " " + fmt(p3[1]));
        pts.push(p1, p2, p3);
      } else if (op === OPS.closePath) segs.push("Z");
      else if (op === OPS.rectangle) {
        const x = coords[c++], y = coords[c++], w = coords[c++], h = coords[c++];
        const q = [mul(ctm, x, y), mul(ctm, x + w, y), mul(ctm, x + w, y + h), mul(ctm, x, y + h)];
        segs.push("M " + q.map((p) => fmt(p[0]) + " " + fmt(p[1])).join(" L ") + " Z");
        pts.push(...q);
      }
    }
  } else if (fn === OPS.fill || fn === OPS.eoFill) {
    if (segs.length) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      paths.push({
        d: segs.join(" "),
        fill: fill.slice(),
        rule: fn === OPS.eoFill ? "evenodd" : "nonzero",
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      });
    }
    segs = []; pts = [];
  } else if (fn === OPS.endPath) { segs = []; pts = []; }
}

console.log("total paths:", paths.length);

/* the symbol sits above the wordmark; split on the vertical gap */
const sorted = [...paths].sort((a, b) => b.bbox[1] - a.bbox[1]);
let cut = null;
for (let i = 0; i < sorted.length - 1; i++) {
  const gap = sorted[i].bbox[1] - sorted[i + 1].bbox[3];
  if (gap > 20) { cut = sorted[i].bbox[1] - gap / 2; break; }
}
const symbol = cut == null ? paths : paths.filter((p) => p.bbox[1] > cut);
console.log("symbol paths:", symbol.length, "| split at y =", cut == null ? "n/a" : fmt(cut));

const xs = symbol.flatMap((p) => [p.bbox[0], p.bbox[2]]);
const ys = symbol.flatMap((p) => [p.bbox[1], p.bbox[3]]);
const x0 = Math.min(...xs), x1 = Math.max(...xs);
const y0 = Math.min(...ys), y1 = Math.max(...ys);
const w = x1 - x0, h = y1 - y0;
console.log("symbol box:", fmt(w), "x", fmt(h));

/* PDF colours come through a duller profile; map them to the brand values */
const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
const brand = (c) => (lum(c) > 140 ? LIGHT : DARK);

const body = symbol
  .map((p) => `  <path d="${p.d}" fill="${brand(p.fill)}" fill-rule="${p.rule}"/>`)
  .join("\n");

/* flip PDF's upward y into SVG space and trim to the symbol */
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" role="img" aria-label="°CRYO Mongolia">\n` +
  `  <title>°CRYO Mongolia</title>\n` +
  `  <!-- vector geometry taken straight from the official logo PDF -->\n` +
  `  <g transform="translate(${fmt(-x0)} ${fmt(y1)}) scale(1 -1)">\n` +
  body +
  `\n  </g>\n</svg>\n`;

fs.writeFileSync(OUT, svg);
console.log("wrote", OUT, (svg.length / 1024).toFixed(1) + "KB");
