// routes/wopi.js - FIXED VERSION

// DEBUG: log anytime this file loads
console.log("WOPI: routes/wopi.js loaded");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const https = require("https");

const router = express.Router();

// ───────────────────────────────────────────────────────────────
// 1) Environment / Config
// ───────────────────────────────────────────────────────────────

// Root folder where case documents are stored on the Node server
const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.join(__dirname, "..", "case-documents");

// Base URL where this Node API is reachable externally
// e.g. https://dev.louislawgroup.com
const PUBLIC_API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL || "http://localhost:3001";

// JWT secret used BOTH by Node and OnlyOffice DocumentServer.
// MUST MATCH services.CoAuthoring.secret.session.string in local.json
const WOPI_TOKEN_SECRET =
  process.env.WOPI_TOKEN_SECRET || "dev-secret";

// Token TTL - Set to 8 hours (in seconds)
const WOPI_TOKEN_TTL_DEFAULT = Number(
  process.env.WOPI_TOKEN_TTL || 8 * 60 * 60
);

// Where OnlyOffice DocumentServer is hosted
// e.g. https://docs.llgdoc.com
const DOCUMENT_SERVER_ORIGIN =
  process.env.DOCUMENT_SERVER_ORIGIN || "https://docs.louislawgroup.com";

// How much clock skew we tolerate when checking exp
const CLOCK_SKEW_SECONDS = 300; // 5 minutes

// ───────────────────────────────────────────────────────────────
// 2) Helpers
// ───────────────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

// Manual HS256 JWT sign (header.payload.signature)
function sign(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const base = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = crypto
    .createHmac("sha256", WOPI_TOKEN_SECRET)
    .update(base)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${base}.${sig}`;
}

// Normalize a relative path to avoid ../ and backslashes
function normalizeRel(p) {
  const s = String(p)
    .replace(/\\/g, "/")
    .replace(/^\/*/, "");
  return s
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

// Build an absolute path inside STORAGE_ROOT
function safeAbs(relPath) {
  return path.join(STORAGE_ROOT, normalizeRel(relPath));
}

// Verify token from OnlyOffice
function verify(token) {
  try {
    if (!token) {
      console.log("WOPI VERIFY ERROR: Missing token");
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      console.log("WOPI VERIFY ERROR: Malformed token");
      return null;
    }

    const [h, p, s] = parts;
    const base = `${h}.${p}`;
    const expected = crypto
      .createHmac("sha256", WOPI_TOKEN_SECRET)
      .update(base)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    if (s !== expected) {
      console.log("WOPI VERIFY ERROR: Signature mismatch");
      return null;
    }

    const payloadJson = Buffer.from(
      p.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && now > payload.exp + CLOCK_SKEW_SECONDS) {
      console.log("WOPI VERIFY ERROR: Token expired", {
        now,
        exp: payload.exp,
        skew: CLOCK_SKEW_SECONDS,
        hoursExpired: (now - payload.exp) / 3600,
      });
      return null;
    }

    if (!payload.relPath) {
      console.log("WOPI VERIFY ERROR: Missing relPath in payload");
      return null;
    }

    payload.relPath = normalizeRel(payload.relPath);
    
    // Log token validity info
    console.log("WOPI VERIFY SUCCESS:", {
      relPath: payload.relPath,
      userId: payload.userId,
      write: payload.write,
      expiresIn: payload.exp ? `${((payload.exp - now) / 3600).toFixed(1)} hours` : 'no expiry',
    });
    
    return payload;
  } catch (err) {
    console.log("WOPI VERIFY ERROR: Exception thrown", err);
    return null;
  }
}

// Extract access_token from query or Authorization header
function getAccessToken(req) {
  const q = req.query.access_token || req.query.accessToken;
  if (q) {
    console.log("WOPI TOKEN SOURCE: query param");
    return String(q);
  }
  const auth = req.headers["authorization"];
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    console.log("WOPI TOKEN SOURCE: Bearer header");
    return auth.slice(7);
  }
  console.log("WOPI TOKEN MISSING: no access_token found");
  return null;
}

// ───────────────────────────────────────────────────────────────
// 3) Issue WOPI token (called by your React app)
// ───────────────────────────────────────────────────────────────
//
// Body:
//  {
//    "relPath": "40293234/CLIENT DOCS/file.docx",
//    "userId": "123",
//    "write": true/false
//  }
//
// Returns:
//  { access_token, access_token_ttl, wopi_src, size, baseFileName }
//
router.post("/token", express.json(), async (req, res) => {
  console.log("WOPI /token request:", req.body);

  try {
    let { relPath, userId, write } = req.body || {};

    if (!relPath || !userId) {
      console.log("WOPI /token ERROR: Missing params");
      return res
        .status(400)
        .json({ error: "relPath and userId are required" });
    }

    relPath = normalizeRel(relPath);
    const abs = safeAbs(relPath);

    if (!fs.existsSync(abs)) {
      console.log("WOPI /token ERROR: File not found:", abs);
      return res
        .status(404)
        .json({ error: `File not found at relPath "${relPath}"` });
    }

    const stat = fs.statSync(abs);

    // Use 8 hour token expiration
    const ttl = WOPI_TOKEN_TTL_DEFAULT;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttl;

    console.log("WOPI /token issued:", {
      relPath,
      userId,
      write: !!write,
      ttlSeconds: ttl,
      ttlHours: ttl / 3600,
      expiresAt: new Date(exp * 1000).toISOString(),
    });

    const payload = {
      relPath,
      userId,
      write: !!write,
      exp,
      iat: now,
      v: 1,
    };

    const access_token = sign(payload);

    const baseUrl = PUBLIC_API_BASE_URL.replace(/\/+$/, "");
    const wopi_src = `${baseUrl}/wopi/files/${encodeURIComponent(relPath)}`;

    res.json({
      access_token,
      access_token_ttl: ttl,
      wopi_src,
      size: stat.size,
      baseFileName: path.basename(relPath),
    });
  } catch (err) {
    console.error("WOPI /token exception:", err);
    res.status(500).json({ error: "Internal error issuing token" });
  }
});

// ───────────────────────────────────────────────────────────────
// 4) Discovery proxy (OnlyOffice <-> Node)
// ───────────────────────────────────────────────────────────────
//
// ONLYOFFICE will NOT call this. This is for your frontend
// to discover the WOPI endpoints from the DocumentServer.
//
router.get("/discovery", async (req, res) => {
  console.log("WOPI /discovery START");

  try {
    const url = `${DOCUMENT_SERVER_ORIGIN.replace(
      /\/+$/,
      ""
    )}/hosting/discovery`;

    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, // if you use self-signed certs
    });

    const r = await axios.get(url, {
      responseType: "text",
      httpsAgent,
    });

    console.log("WOPI /discovery SUCCESS");

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(r.data);
  } catch (err) {
    console.error(
      "WOPI /discovery ERROR:",
      err?.code,
      err?.message || err?.toString()
    );
    res.status(502).send("Failed to fetch discovery");
  }
});

// ───────────────────────────────────────────────────────────────
// 5) CheckFileInfo - FIXED VERSION
// ───────────────────────────────────────────────────────────────
//
// Called by OnlyOffice DocumentServer with ?access_token=...
// This is the CRITICAL endpoint that was causing your session expiry error
//
router.get("/files/:id", (req, res) => {
  console.log("WOPI CheckFileInfo START:", req.params.id);

  const token = getAccessToken(req);
  const payload = verify(token);

  if (!payload) {
    console.log("WOPI CheckFileInfo ERROR: Token verify fail", {
      url: req.originalUrl,
      query: req.query,
      hasAuthHeader: !!req.headers["authorization"],
      tokenSnippet: token ? token.slice(0, 40) + "..." : null,
      time: new Date().toISOString(),
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const relParam = normalizeRel(decodeURIComponent(req.params.id));

  if (relParam !== payload.relPath) {
    console.log("WOPI CheckFileInfo ERROR: relPath mismatch", {
      relParam,
      payloadPath: payload.relPath,
    });
    return res.status(403).json({ error: "Token relPath mismatch" });
  }

  const abs = safeAbs(relParam);
  if (!fs.existsSync(abs)) {
    console.log("WOPI CheckFileInfo ERROR: File missing at", abs);
    return res.status(404).json({ error: "File not found" });
  }

  const stat = fs.statSync(abs);
  
  // FIX: Simplified info object without session timeouts
  // OnlyOffice manages sessions differently than Microsoft WOPI
  const info = {
    // File information
    BaseFileName: path.basename(relParam),
    Size: stat.size,
    Version: String(stat.mtimeMs || Date.now()),
    LastModifiedTime: new Date(stat.mtimeMs || Date.now()).toISOString(),
    
    // User information
    OwnerId: "llg",
    UserId: payload.userId,
    UserFriendlyName: payload.userId,
    
    // Capabilities - what operations are supported
    SupportsUpdate: true,
    UserCanWrite: !!payload.write,
    ReadOnly: !payload.write,
    
    // Lock capabilities - disabled for simplicity
    SupportsLocks: false,
    SupportsGetLock: false,
    
    // Additional capabilities
    SupportsRename: false,
    SupportsDeleteFile: false,
    SupportsCobalt: false,
    SupportsFolders: false,
    SupportsScenarioLinks: false,
    SupportsSecureStore: false,
    
    // UI elements
    BreadcrumbDocName: path.basename(relParam),
    
    // Optional URLs
    CloseUrl: `${PUBLIC_API_BASE_URL}/editor/close`,
    DownloadUrl: `${PUBLIC_API_BASE_URL}/wopi/files/${encodeURIComponent(relParam)}/contents?access_token=${token}`,
  };

  console.log("WOPI CheckFileInfo SUCCESS:", {
    file: info.BaseFileName,
    userId: info.UserId,
    canWrite: info.UserCanWrite,
    size: info.Size,
    version: info.Version,
  });

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json(info);
});

// ───────────────────────────────────────────────────────────────
// 6) GetFile (download)
// ───────────────────────────────────────────────────────────────
//
// Called by OnlyOffice to load the file content.
//
router.get("/files/:id/contents", (req, res) => {
  console.log("WOPI GetFile START:", req.params.id);

  const token = getAccessToken(req);
  const payload = verify(token);

  if (!payload) {
    console.log("WOPI GetFile ERROR: Invalid token");
    return res.status(401).end();
  }

  const relParam = normalizeRel(decodeURIComponent(req.params.id));
  if (relParam !== payload.relPath) {
    console.log("WOPI GetFile ERROR: relPath mismatch", {
      relParam,
      payloadPath: payload.relPath,
    });
    return res.status(403).end();
  }

  const abs = safeAbs(relParam);
  if (!fs.existsSync(abs)) {
    console.log("WOPI GetFile ERROR: File missing", abs);
    return res.status(404).end();
  }

  const stat = fs.statSync(abs);
  console.log("WOPI GetFile SUCCESS:", {
    file: path.basename(relParam),
    size: stat.size,
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Length", stat.size);
  
  fs.createReadStream(abs).pipe(res);
});

// ───────────────────────────────────────────────────────────────
// 7) PutFile (save)
// ───────────────────────────────────────────────────────────────
//
// Called by OnlyOffice to save the file back.
//
router.post(
  "/files/:id/contents",
  express.raw({ type: "*/*", limit: "200mb" }),
  (req, res) => {
    console.log("WOPI PutFile START:", req.params.id);

    const token = getAccessToken(req);
    const payload = verify(token);

    if (!payload) {
      console.log("WOPI PutFile ERROR: Invalid token");
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    
    if (!payload.write) {
      console.log("WOPI PutFile ERROR: Read-only token");
      return res.status(403).json({ error: "Read-only token" });
    }

    const relParam = normalizeRel(decodeURIComponent(req.params.id));
    if (relParam !== payload.relPath) {
      console.log("WOPI PutFile ERROR: relPath mismatch", {
        relParam,
        payloadPath: payload.relPath,
      });
      return res.status(403).json({ error: "Token relPath mismatch" });
    }

    const abs = safeAbs(relParam);
    const dir = path.dirname(abs);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(abs, req.body);
      
      const stat = fs.statSync(abs);
      
      console.log("WOPI PutFile SUCCESS:", {
        file: path.basename(relParam),
        size: stat.size,
        savedAt: new Date().toISOString(),
      });
      
      // Return the new file info
      res.status(200).json({
        Name: path.basename(relParam),
        Size: stat.size,
        Version: String(stat.mtimeMs || Date.now()),
        LastModifiedTime: new Date(stat.mtimeMs || Date.now()).toISOString(),
      });
    } catch (err) {
      console.error("WOPI PutFile ERROR:", err);
      return res.status(500).json({ error: "Failed to store file" });
    }
  }
);

// ───────────────────────────────────────────────────────────────
// 8) Health check endpoint (optional but recommended)
// ───────────────────────────────────────────────────────────────
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    storageRoot: STORAGE_ROOT,
    documentServer: DOCUMENT_SERVER_ORIGIN,
  });
});

module.exports = router;