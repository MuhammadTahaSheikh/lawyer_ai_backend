const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

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
      realtime: { transport: WebSocket },
    });
  }
  return adminClient;
}

async function findAuthUidByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  const admin = getSupabaseAdmin();
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const match = (data?.users || []).find(
      (u) => (u.email || "").trim().toLowerCase() === normalized
    );
    if (match) return match.id;
    if (!data?.users?.length || data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function resolveAuthUid({ uid, email }) {
  if (uid) return uid;
  if (email) return findAuthUidByEmail(email);
  return null;
}

/** Delete Supabase Auth user by uid and/or email lookup. */
async function deleteAuthUserByUidOrEmail({ uid, email }) {
  const authUid = await resolveAuthUid({ uid, email });
  if (!authUid) return { deleted: false };
  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(authUid);
  if (error) throw error;
  return { deleted: true, uid: authUid };
}

/** Sync email/name changes to Supabase Auth (must run before DB email update). */
async function updateAuthUserProfile({
  uid,
  oldEmail,
  email,
  first_name,
  last_name,
}) {
  const authUid = await resolveAuthUid({ uid, email: oldEmail });
  if (!authUid) return { updated: false };

  const updates = {};
  const newEmail = (email || "").trim();
  const oldNorm = (oldEmail || "").trim().toLowerCase();
  if (newEmail && newEmail.toLowerCase() !== oldNorm) {
    updates.email = newEmail;
    updates.email_confirm = true;
  }
  if (first_name != null || last_name != null) {
    const fn = (first_name ?? "").trim();
    const ln = (last_name ?? "").trim();
    updates.user_metadata = {
      display_name: `${fn} ${ln}`.trim(),
      first_name: fn,
      last_name: ln,
    };
  }
  if (!Object.keys(updates).length) return { updated: false };

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(authUid, updates);
  if (error) throw error;
  return { updated: true, uid: authUid };
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseUrl,
  deleteAuthUserByUidOrEmail,
  updateAuthUserProfile,
};
