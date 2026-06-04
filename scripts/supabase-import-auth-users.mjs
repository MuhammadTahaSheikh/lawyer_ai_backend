/**
 * Create Supabase Auth accounts for all active_users emails (read-only on MySQL data in PG).
 * Requires SUPABASE_SERVICE_ROLE_KEY in scripts/.env.migration or env.
 *
 * Usage:
 *   node scripts/supabase-import-auth-users.mjs
 *   SEND_RESET=1 node scripts/supabase-import-auth-users.mjs   # email password reset links
 */
import "dotenv/config";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationEnv = join(__dirname, ".env.migration");
if (existsSync(migrationEnv)) {
  for (const line of readFileSync(migrationEnv, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function getSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_MIGRATION_URL || "";
  const m = dbUrl.match(/postgres\.([a-z0-9]+)/i);
  if (m) return `https://${m[1]}.supabase.co`;
  throw new Error("Set SUPABASE_URL or SUPABASE_DB_URL");
}

const SEND_RESET = process.env.SEND_RESET === "1";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role)");
  process.exit(1);
}

const supabase = createClient(getSupabaseUrl(), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pgPool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.SUPABASE_MIGRATION_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});

async function main() {
  const { rows } = await pgPool.query(
    `SELECT staff_id, uid, email, first_name, last_name
     FROM active_users WHERE email IS NOT NULL AND TRIM(email) <> ''`
  );
  console.log(`Importing ${rows.length} users into Supabase Auth...\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const email = row.email.trim();
    const tempPassword = crypto.randomBytes(16).toString("base64url") + "Aa1!";

    let found = null;
    const { data: existingData, error: lookupErr } =
      await supabase.auth.admin.getUserByEmail(email);
    if (!lookupErr && existingData?.user) found = existingData.user;

    if (found) {
      await pgPool.query(
        `UPDATE active_users SET uid = ?, updated_at = NOW() WHERE staff_id = ?`,
        [found.id, row.staff_id]
      );
      skipped++;
      console.log(`  exists  ${email} → uid ${found.id}`);
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: row.first_name,
        last_name: row.last_name,
      },
    });

    if (error) {
      errors++;
      console.error(`  FAIL    ${email}: ${error.message}`);
      continue;
    }

    await pgPool.query(
      `UPDATE active_users SET uid = ?, updated_at = NOW() WHERE staff_id = ?`,
      [data.user.id, row.staff_id]
    );
    created++;
    console.log(`  created ${email} → uid ${data.user.id}`);

    if (SEND_RESET) {
      await supabase.auth.resetPasswordForEmail(email);
    }
  }

  console.log(`\nDone. created=${created} linked=${skipped} errors=${errors}`);
  if (created && !SEND_RESET) {
    console.log("Tip: run with SEND_RESET=1 to email password setup links to new users.");
  }
  await pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
