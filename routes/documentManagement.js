// routes/documentManagement.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const DOCUMENTS_BASE_PATH = path.join(__dirname, "..", "case-documents");
if (!fs.existsSync(DOCUMENTS_BASE_PATH)) {
  fs.mkdirSync(DOCUMENTS_BASE_PATH, { recursive: true });
}

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const caseId = req.params.caseId;
    const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseId);
    if (!fs.existsSync(caseFolder)) {
      fs.mkdirSync(caseFolder, { recursive: true });
    }
    cb(null, caseFolder);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const documentUpload = multer({ storage: documentStorage });

// GET /cases/:caseId/documents – list documents for a specific case
router.get("/cases/:caseId/documents", (req, res) => {
  const caseId = req.params.caseId;
  const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseId);
  if (!fs.existsSync(caseFolder)) return res.status(404).json({ message: "No documents found for this case." });
  fs.readdir(caseFolder, (err, files) => {
    if (err) return res.status(500).json({ message: "Error reading documents directory." });
    files = files.filter(file => !file.startsWith("."));
    res.json({ documents: files });
  });
});

// POST /cases/:caseId/documents – upload a new document and save metadata
router.post("/cases/:caseId/documents", documentUpload.single("document"), async (req, res) => {
  const db = req.app.locals.db;
  if (!req.file) return res.status(400).json({ message: "No document uploaded." });
  const { name, description, assigned_date } = req.body;
  const caseId = req.params.caseId;
  const fileName = req.file.filename;
  const filePath = path.join("case-documents", caseId, fileName);
  const query = `
    INSERT INTO documents (name, filename, path, description, assigned_date, case_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;
  try {
    const [result] = await db.promise().query(query, [name, fileName, filePath, description, assigned_date, caseId]);
    const userUid = req.headers['x-user-uid'];
    if (!userUid) return res.status(401).json({ message: "User UID missing in request headers" });
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedTimestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
    await db.promise().query(
      "INSERT INTO document_activity_logs (uid, document_id, case_id, action, timestamp) VALUES (?, ?, ?, ?, ?)",
      [userUid, result.insertId, caseId, 'upload', formattedTimestamp]
    );
    res.json({
      message: "Document uploaded and metadata saved successfully.",
      fileName,
      originalName: req.file.originalname,
      documentId: result.insertId
    });
  } catch (err) {
    console.error("Error inserting document metadata:", err.sqlMessage || err);
    res.status(500).json({ message: "Error saving document metadata or activity.", error: err.sqlMessage });
  }
});

// GET /documents/activity – fetch document activity logs
router.get("/documents/activity", async (req, res) => {
  const db = req.app.locals.db;
  const query = `
    SELECT 
      dal.uid,
      au.first_name,
      au.last_name,
      dal.document_id,
      d.name AS document_name,
      d.filename,
      d.case_id,
      dal.action,
      dal.timestamp
    FROM document_activity_logs dal
    JOIN documents d ON dal.document_id = d.id
    JOIN active_users au ON dal.uid = au.uid
    ORDER BY dal.timestamp DESC
  `;
  try {
    const [rows] = await db.promise().query(query);
    res.json({ activities: rows });
  } catch (err) {
    console.error("Error fetching document activity logs:", err);
    res.status(500).json({ error: "Failed to fetch document activity logs" });
  }
});

// GET /cases/:caseId/documents/:filename – download a document
router.get("/cases/:caseId/documents/:filename", (req, res) => {
  const { caseId, filename } = req.params;
  const filePath = path.join(DOCUMENTS_BASE_PATH, caseId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  res.download(filePath, filename, (err) => {
    if (err) res.status(500).json({ message: "Error downloading document." });
  });
});

// GET /documents – list ALL documents (with optional case filtering)
router.get("/documents", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const caseIdFilter = req.query.case_id;
  if (caseIdFilter) {
    const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseIdFilter);
    if (!fs.existsSync(caseFolder)) return res.json({ totalDocuments: 0, documents: [] });
    fs.readdir(caseFolder, (err, files) => {
      if (err) return res.status(500).json({ message: "Error reading documents directory." });
      files = files.filter(file => !file.startsWith("."));
      const totalDocuments = files.length;
      const paginatedDocs = files.slice(offset, offset + limit).map(file => ({ caseId: caseIdFilter, fileName: file }));
      res.json({ totalDocuments, documents: paginatedDocs });
    });
  } else {
    fs.readdir(DOCUMENTS_BASE_PATH, (err, caseFolders) => {
      if (err) return res.status(500).json({ message: "Error reading documents base folder." });
      caseFolders = caseFolders.filter(folder => !folder.startsWith("."));
      if (caseFolders.length === 0) return res.json({ totalDocuments: 0, documents: [] });
      let allDocuments = [];
      let pending = caseFolders.length;
      caseFolders.forEach(folder => {
        const folderPath = path.join(DOCUMENTS_BASE_PATH, folder);
        fs.readdir(folderPath, (err, files) => {
          if (!err && files) {
            files = files.filter(file => !file.startsWith("."));
            files.forEach(file => allDocuments.push({ caseId: folder, fileName: file }));
          }
          pending--;
          if (pending === 0) {
            const totalDocuments = allDocuments.length;
            const paginatedDocs = allDocuments.slice(offset, offset + limit);
            res.json({ totalDocuments, documents: paginatedDocs });
          }
        });
      });
    });
  }
});

// GET /cases/:caseId/documents/:filename/view – serve document inline
router.get("/cases/:caseId/documents/:filename/view", (req, res) => {
  const { caseId, filename } = req.params;
  const filePath = path.join(DOCUMENTS_BASE_PATH, caseId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  res.sendFile(filePath);
});

module.exports = router;