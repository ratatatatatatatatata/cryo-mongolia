/* ══════════════════════════════════════════════════════════════
   Writes supabase-config.js from environment variables at build time.

   This is a plain static site, so nothing injects env vars into the
   browser on its own — Vercel only exposes them to the build command.
   Run by `vercel.json` → buildCommand, and by the Pages workflow.

   Reads (first match wins):
     SUPABASE_url          | SUPABASE_URL          | VITE_SUPABASE_URL
     SUPABASE_anon_public  | SUPABASE_ANON_KEY     | VITE_SUPABASE_ANON_KEY

   If neither is set the committed file is left untouched, so local
   development and forks keep working.
   ══════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "supabase-config.js");

const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return "";
};

const url = pick("SUPABASE_url", "SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const key = pick(
  "SUPABASE_anon_public",
  "SUPABASE_ANON_KEY",
  "SUPABASE_ANON_PUBLIC",
  "VITE_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

if (!url || !key) {
  console.warn(
    "[build-config] SUPABASE_url / SUPABASE_anon_public not set — keeping the committed supabase-config.js.",
  );
  console.warn("[build-config] url:", url ? "set" : "MISSING", "· key:", key ? "set" : "MISSING");
  process.exit(0);
}

/* a service_role key must never reach the browser */
try {
  const claims = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64").toString("utf8"));
  if (claims && claims.role && claims.role !== "anon") {
    console.error(
      `[build-config] refusing to publish a "${claims.role}" key. Use the anon / public key.`,
    );
    process.exit(1);
  }
} catch {
  /* newer publishable keys are not JWTs — nothing to inspect */
}

const out = `/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — Supabase connection
   GENERATED AT BUILD TIME from SUPABASE_url / SUPABASE_anon_public.
   Edit those environment variables, not this file.
   The anon key is publishable; Row Level Security protects the data.
   ══════════════════════════════════════════════════════════════ */
window.CRYO_SUPABASE = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(key)},
};
`;

fs.writeFileSync(target, out);
console.log(`[build-config] wrote supabase-config.js → ${url} (key ${key.length} chars)`);
