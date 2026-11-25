/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — Supabase connection
   The anon key is a PUBLISHABLE key: it is meant to sit in client
   code and is safe to commit. Row Level Security (supabase/setup.sql)
   is what actually protects the data.
   NEVER put the service_role key in this file.
   ══════════════════════════════════════════════════════════════ */
window.CRYO_SUPABASE = {
  url: "https://jrvftmbmuumzqwzrqizd.supabase.co",

  // Supabase Dashboard → Project Settings → API Keys → anon / public
  anonKey: "sb_publishable_DRbxW-3ZR1KGuNyDuJJOzw_lvmfuXPU",
};
