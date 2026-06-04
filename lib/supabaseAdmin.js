const { createClient } = require("@supabase/supabase-js");

function getSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  const dbUrl = process.env.SUPABASE_DB_URL || "";
  const m = dbUrl.match(/postgres\.([a-z0-9]+)/i);
  if (m) return `https://${m[1]}.supabase.co`;
  return null;
}

let adminClient = null;

function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL (or infer from SUPABASE_DB_URL)");
    if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    throw new Error(
      `Missing ${missing.join(" and ")}. Add service_role key in backend .env (Supabase Dashboard → Settings → API).`
    );
  }
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

module.exports = { getSupabaseAdmin, getSupabaseUrl };
