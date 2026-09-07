/* Splits generated SQL across several files.

   The Supabase SQL editor keeps what you paste as a saved snippet, and a
   few hundred kilobytes of it will not save — the tab just sits there with
   unsaved edits. So write the statements out in numbered parts small
   enough to paste one at a time.

   Order matters: part 1 carries the header, which is where the clear-out
   runs, and later parts depend on rows earlier ones inserted. Run them in
   order. */

import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 120 * 1024;

export function writeParts(out, header, chunks, { maxBytes = MAX_BYTES } = {}) {
  const groups = [];
  let current = [];
  let size = header.length;

  chunks.forEach((chunk) => {
    if (current.length && size + chunk.length > maxBytes) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(chunk);
    size += chunk.length + 2;
  });
  if (current.length) groups.push(current);

  const dir = path.dirname(out);
  const ext = path.extname(out);
  const base = path.basename(out, ext);

  /* a previous run may have made more parts than this one needs */
  fs.readdirSync(dir)
    .filter((f) => new RegExp(`^${base}-part\\d+${ext}$`).test(f))
    .forEach((f) => fs.unlinkSync(path.join(dir, f)));

  const files = groups.map((group, i) => {
    const file =
      groups.length === 1 ? out : path.join(dir, `${base}-part${i + 1}${ext}`);
    const banner =
      groups.length === 1
        ? ""
        : `-- ══ part ${i + 1} of ${groups.length} — run the parts in order ══\n\n`;
    fs.writeFileSync(file, (i === 0 ? header : "") + banner + group.join("\n\n") + "\n");
    return file;
  });

  if (groups.length === 1) {
    console.log("wrote " + files[0]);
  } else {
    console.log(
      `\nwrote ${files.length} parts (the SQL editor cannot save one file this big) — run them in order:`,
    );
    files.forEach((f) =>
      console.log("  " + path.basename(f) + "  " + (fs.statSync(f).size / 1024).toFixed(0) + " KB"),
    );
  }
  return files;
}
