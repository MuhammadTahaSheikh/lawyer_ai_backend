// routes/wopiHost.js
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const { validateToken } = require("./wopi"); // uses the token store from routes/wopi.js

const router = express.Router();

// Base folder: reuse your existing static path
// server.js already has: app.use("/case-documents", express.static(path.join(__dirname, "case-documents")));
const STORAGE_DIR = process.env.LOCAL_WOPI_DIR || path.join(__dirname, "..", "case-documents");

// Parse fileId "case:7430148|doc:pleading_001" -> { caseId, docId }
function parseFileId(fileId) {
  const mCase = /(?:^|)case:([^|]+)(?:\||$)/.exec(fileId);
  const mDoc  = /(?:^|)doc:([^|]+)(?:\||$)/.exec(fileId);
  const caseId = mCase && mCase[1] ? mCase[1] : null;
  const docId  = mDoc && mDoc[1] ? mDoc[1] : null;
  return { caseId, docId };
}

// Build the on-disk path for the DOCX we serve/edit
function storagePath(fileId) {
  const { caseId, docId } = parseFileId(fileId);
  if (!caseId || !docId) throw new Error("Invalid fileId");
  // e.g. case-documents/cases/7430148/docs/pleading_001.docx
  return path.join(STORAGE_DIR, "cases", caseId, "docs", `${docId}.docx`);
}

async function ensureDirFor(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

// Simple access check: token must match fileId
function checkAccess(req, res, fileId) {
  const token = (req.query.access_token || "").toString();
  if (!validateToken(token, fileId)) {
    res.status(401).send("Invalid or expired access_token");
    return false;
  }
  return true;
}

/**
 * WOPI: CheckFileInfo
 * GET /wopi/files/:fileId  with header: X-WOPI-Override: CHECK_FILE_INFO
 */
router.get("/files/:fileId", async (req, res) => {
  const fileId = decodeURIComponent(req.params.fileId);
  if (!checkAccess(req, res, fileId)) return;

  if ((req.get("X-WOPI-Override") || "").toUpperCase() !== "CHECK_FILE_INFO") {
    return res.status(400).send("Missing X-WOPI-Override: CHECK_FILE_INFO");
  }

  const p = storagePath(fileId);
  await ensureDirFor(p);

  let size = 0;
  try {
    const stat = await fs.stat(p);
    size = stat.size;
  } catch {
    // if missing, seed an empty file (editor can still open)
    await fs.writeFile(p, Buffer.alloc(0));
  }

  const { caseId, docId } = parseFileId(fileId);
  const name = `case_${caseId}_${docId}.docx`;

  res.json({
    BaseFileName: name,
    OwnerId: "llg",
    Size: size,
    Version: Date.now().toString(),
    SupportsUpdate: true,
    SupportsLocks: true,
    UserCanWrite: true,
    UserFriendlyName: "LLG User",
    SupportsGetLock: true,
    SupportsExtendedLockLength: true,
  });
});

/**
 * WOPI: GetFile
 * GET /wopi/files/:fileId/contents
 */
router.get("/files/:fileId/contents", async (req, res) => {
  const fileId = decodeURIComponent(req.params.fileId);
  if (!checkAccess(req, res, fileId)) return;

  const p = storagePath(fileId);
  await ensureDirFor(p);
  try {
    const buf = await fs.readFile(p);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.send(buf);
  } catch {
    res.status(404).send("File not found");
  }
});

/**
 * WOPI: PutFile
 * POST /wopi/files/:fileId/contents
 */
router.post("/files/:fileId/contents", async (req, res) => {
  const fileId = decodeURIComponent(req.params.fileId);
  if (!checkAccess(req, res, fileId)) return;

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);

    const p = storagePath(fileId);
    await ensureDirFor(p);
    await fs.writeFile(p, buf);

    res.status(200).end(); // per WOPI spec
  } catch (e) {
    console.error("PutFile error", e);
    res.status(500).send("Save failed");
  }
});

module.exports = router;