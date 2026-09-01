/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — Supabase connection
   The anon key is a PUBLISHABLE key: it is meant to sit in client
   code and is safe to commit. Row Level Security (supabase/schema.sql)
   is what actually protects the data.
   NEVER put the service_role key in this file.
   ══════════════════════════════════════════════════════════════ */
window.CRYO_SUPABASE = {
  url: "https://nbgmjcrqmzsohqnelcpz.supabase.co",

  // Supabase Dashboard → Project Settings → API Keys → anon / public
  anonKey: "",
};
