const express = require("express");
const router = express.Router();
const db = require("../db");
const { getSupabaseAdmin } = require("../lib/supabaseAdmin");

/** Link Supabase Auth user id to active_users row by email (post-login). */
router.post("/auth/link-session", async (req, res) => {
  const { uid, email } = req.body || {};
  if (!uid || !email) {
    return res.status(400).json({ message: "uid and email are required" });
  }
  try {
    const [result] = await db.promise().query(
      `UPDATE active_users SET uid = ?, updated_at = NOW()
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [uid, email]
    );
    return res.json({
      success: true,
      updated: (result.affectedRows ?? result.rowCount ?? 0) > 0,
    });
  } catch (err) {
    console.error("auth/link-session:", err);
    return res.status(500).json({ message: "Failed to link session" });
  }
});

const PRODUCTION_SET_PASSWORD_URL =
  "https://lawyer-ai-eight.vercel.app/set-password";

function resolvePasswordResetRedirect(req) {
  const fromBody = (req.body?.redirectTo || "").trim();
  if (fromBody) return fromBody;

  const frontendOrigin = (req.headers["x-frontend-origin"] || "").trim();
  if (frontendOrigin) {
    try {
      return `${new URL(frontendOrigin).origin}/set-password`;
    } catch (_) {
      /* ignore */
    }
  }

  const origin = (req.headers.origin || "").trim();
  if (origin) {
    try {
      return `${new URL(origin).origin}/set-password`;
    } catch (_) {
      /* ignore */
    }
  }

  const referer = (req.headers.referer || "").trim();
  if (referer) {
    try {
      return `${new URL(referer).origin}/set-password`;
    } catch (_) {
      /* ignore */
    }
  }

  if (process.env.FRONTEND_URL) {
    const base = process.env.FRONTEND_URL.replace(/\/$/, "");
    return `${base}/set-password`;
  }

  if (process.env.SUPABASE_RESET_REDIRECT) {
    return process.env.SUPABASE_RESET_REDIRECT.trim();
  }

  return PRODUCTION_SET_PASSWORD_URL;
}

/** Supabase may fall back to Site URL (localhost) if redirect is not whitelisted in dashboard. */
function applyRedirectToLink(link, redirectTo) {
  try {
    const url = new URL(link);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch (_) {
    return link;
  }
}

function generateTemporaryPassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/** Admin create Supabase Auth user (Settings → User Management). */
router.post("/auth/admin/create-user", async (req, res) => {
  const { email, password: providedPassword } = req.body || {};
  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }
  const password = (providedPassword || "").trim() || generateTemporaryPassword();
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(201).json({
      uid: data.user.id,
      email: data.user.email,
    });
  } catch (err) {
    console.error("auth/admin/create-user:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to create auth user" });
  }
});

/** Admin: generate password recovery link without sending email (avoids auth email rate limits). */
router.post("/auth/admin/recovery-link", async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }
  try {
    const admin = getSupabaseAdmin();
    const redirectTo = resolvePasswordResetRedirect(req);
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (error) {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    const rawLink =
      data?.properties?.action_link || data?.action_link || null;
    if (!rawLink) {
      return res.status(500).json({ message: "Recovery link was not returned" });
    }
    const link = applyRedirectToLink(rawLink, redirectTo);
    return res.json({
      link,
      redirectTo,
      supabaseRedirectFixed: link !== rawLink,
    });
  } catch (err) {
    console.error("auth/admin/recovery-link:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to generate recovery link" });
  }
});

/** Lookup user by email (login disabled check). */
router.get("/users/by-email/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const [rows] = await db.promise().query(
      `SELECT staff_id, uid, first_name, last_name, email, disabled, type
       FROM active_users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1`,
      [email]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "User not found for email." });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error("users/by-email:", err);
    return res.status(500).json({ message: "Error fetching user." });
  }
});

module.exports = router;
