const express   = require("express");
const router    = express.Router();
const path      = require("path");
const fs        = require("fs");
const multer    = require("multer");
const db        = require("../db");
const logger    = require("../logger");  // structured logger

// bump JSON-body limit for move/rename endpoints
router.use(express.json({ limit: "50mb" }));

// Base directories
const DOCUMENTS_BASE_PATH = path.join(__dirname, "..", "case-documents");
const TEMP_UPLOADS = path.join(__dirname, "..", "temp-uploads");
if (!fs.existsSync(TEMP_UPLOADS)) {
  fs.mkdirSync(TEMP_UPLOADS, { recursive: true });
}

const templatesDir        = path.join(__dirname, "..", "case_templates");
const templatesDirE = path.join(__dirname, '..', 'case-eSignTemplate');



// ensure base folder exists
if (!fs.existsSync(DOCUMENTS_BASE_PATH)) {
  fs.mkdirSync(DOCUMENTS_BASE_PATH, { recursive: true });
}

// dynamic storage for uploaded files
const getDynamicStorage = () => multer.diskStorage({
  destination: (req, file, cb) => {
    const caseId = req.params.caseId;
    const folder = req.headers["x-folder-name"] || "";
    const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseId, folder);
    if (!fs.existsSync(caseFolder)) {
      fs.mkdirSync(caseFolder, { recursive: true });
    }
    cb(null, caseFolder);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9\.\-_]/g, "_");
    cb(null, safeName);
  }
});

// file size limit (50 MB default)
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE_BYTES
  ? parseInt(process.env.MAX_FILE_SIZE_BYTES, 10)
  : 50 * 1024 * 1024;

const documentUpload = multer({
  storage: getDynamicStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

// GET /documents – list all documents (with optional search, pagination)
router.get("/documents", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const caseIdFilter = req.query.case_id;
  const searchTerm = req.query.search?.trim();
  const uid = req.query.uid;
  const showAll = req.query.show_all === "true";

  const getCaseNames = (caseIds) => new Promise((resolve) => {
    if (!caseIds || caseIds.length === 0) return resolve({});
    const ids = Array.isArray(caseIds) ? caseIds : [caseIds];
    const query = 'SELECT case_id, name FROM cases WHERE case_id IN (?)';
    db.query(query, [ids], (err, results) => {
      if (err) {
        logger.error("Database query error in GET /documents", {
          route: "/documents",
          message: err.message, stack: err.stack
        });
        return resolve({});
      }
      const map = {};
      results.forEach(r => map[r.case_id] = r.name);
      resolve(map);
    });
  });

  let permittedCaseIds = [];

 if (uid && !showAll) {
  try {
    const [permissions] = await db.promise().query(`
      SELECT 
        (SELECT GROUP_CONCAT(DISTINCT case_id) FROM user_case_assignments WHERE uid = ?) AS case_ids,
        (SELECT GROUP_CONCAT(DISTINCT practice_area) FROM user_practice_areas WHERE uid = ?) AS practice_areas
    `, [uid, uid]);

    const caseIds = permissions[0]?.case_ids?.split(',').filter(Boolean) || [];
    const practiceAreas = permissions[0]?.practice_areas?.split(',').filter(Boolean) || [];

    if (caseIds.length === 0 && practiceAreas.length === 0) {
      // No filters selected – allow showing all documents
      permittedCaseIds = []; // Don't filter folders
    } else {
      permittedCaseIds = [...caseIds];

      if (practiceAreas.length > 0) {
        const [casesByPracticeArea] = await db.promise().query(
          `SELECT case_id FROM cases WHERE practice_area IN (${practiceAreas.map(() => '?').join(',')})`,
          practiceAreas
        );
        permittedCaseIds.push(...casesByPracticeArea.map(row => String(row.case_id)));
      }

      permittedCaseIds = [...new Set(permittedCaseIds)];
    }
  } catch (err) {
    console.error("Error fetching document permissions:", err);
    return res.status(500).json({ message: "Error fetching document permissions" });
  }
}


  const fetchDocumentsForCases = (caseFolders) => {
    caseFolders = caseFolders.filter(f => !f.startsWith('.'));
    if (caseFolders.length === 0) {
      return res.json({ totalDocuments: 0, documents: [] });
    }
    const all = [];
    let pending = caseFolders.length;
    getCaseNames(caseFolders).then(caseMap => {
      caseFolders.forEach(folder => {
        const folderPath = path.join(DOCUMENTS_BASE_PATH, folder);
        fs.readdir(folderPath, (err, files) => {
          if (err) {
            logger.error("Error reading folder in GET /documents", {
              route: "/documents", folder,
              message: err.message, stack: err.stack
            });
          } else {
            files.filter(f => !f.startsWith('.')).forEach(file => {
              all.push({ caseId: folder, caseName: caseMap[folder] || null, fileName: file });
            });
          }
          if (--pending === 0) {
            const total = all.length;
            res.json({ totalDocuments: total, documents: all.slice(offset, offset + limit) });
          }
        });
      });
    });
  };

  // search
  if (searchTerm) {
    db.query("SELECT case_id FROM cases WHERE name LIKE ?", [`%${searchTerm}%`], (err, results) => {
      if (err) {
        logger.error("Search query error in GET /documents", {
          route: "/documents", message: err.message, stack: err.stack
        });
        return res.status(500).json({ message: "Error searching case names." });
      }
      const ids = results.map(r => String(r.case_id));
      return fetchDocumentsForCases(ids);
    });
    return;
  }

  // filter by case_id
  if (caseIdFilter) {
    const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseIdFilter);
    if (!fs.existsSync(caseFolder)) {
      return res.json({ totalDocuments: 0, documents: [] });
    }
    fs.readdir(caseFolder, async (err, files) => {
      if (err) {
        logger.error("Error reading documents directory", { route: "/documents?case_id", caseIdFilter, message: err.message, stack: err.stack });
        return res.status(500).json({ message: "Error reading documents directory." });
      }
      const good = files.filter(f => !f.startsWith('.'));
      const total = good.length;
      const caseMap = await getCaseNames(caseIdFilter);
      const slice = good.slice(offset, offset + limit).map(file => ({ caseId: caseIdFilter, caseName: caseMap[caseIdFilter] || null, fileName: file }));
      res.json({ totalDocuments: total, documents: slice });
    });
    return;
  }

  // list all or filter based on permission
  fs.readdir(DOCUMENTS_BASE_PATH, async (err, caseFolders) => {
    if (err) {
      logger.error("Error reading documents base folder", { route: "/documents", message: err.message, stack: err.stack });
      return res.status(500).json({ message: "Error reading documents base folder." });
    }

    caseFolders = caseFolders.filter(f => !f.startsWith('.'));

    // filter folders if uid & permissions apply
   if (uid && !showAll && permittedCaseIds.length > 0) {
  caseFolders = caseFolders.filter(folder => permittedCaseIds.includes(folder));
}


    const caseMap = await getCaseNames(caseFolders);
    const walkDir = (dir, parent = "") => {
      const out = [];
      fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        if (entry.name.startsWith('.')) return;
        const full = path.join(dir, entry.name);
        const relId = path.relative(DOCUMENTS_BASE_PATH, dir).split(path.sep)[0];
        if (entry.isDirectory()) {
          out.push(...walkDir(full, path.join(parent, entry.name)));
        } else {
          out.push({ caseId: relId, caseName: caseMap[relId] || null, fileName: entry.name, folder: parent.replace(/\\/g, "/") });
        }
      });
      return out;
    };
    let allDocs = [];
    caseFolders.forEach(folder => {
      try {
        allDocs.push(...walkDir(path.join(DOCUMENTS_BASE_PATH, folder)));
      } catch (e) {
        logger.error("Error walking folder in GET /documents", { route: "/documents", folder, message: e.message, stack: e.stack });
      }
    });
    res.json({ totalDocuments: allDocs.length, documents: allDocs.slice(offset, offset + limit) });
  });
});


// GET /templates – list document templates
router.get('/templates', (req, res) => {
  // 1) Initialize your structure object exactly as before.
  //    “All Document Templates” will collect every valid file across categories.
  const structure = { 'All Document Templates': [] };

  // 2) Helper function that recursively walks through directories.
  //    We add a simple check to skip anything whose name starts with “.”.
  const walk = (dir, category) => {
    // Ensure the category key exists in “structure”
    if (!structure[category]) {
      structure[category] = [];
    }

    // Read every entry (files + folders) in “dir”
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // If this entry is a folder, dive in. Use its folder name as the new “category.”
        walk(fullPath, entry.name);
      } else {
        // ENTRY IS A FILE
        // 3) Skip any filename that begins with “.”
        if (entry.name.startsWith('.')) {
          return; 
        }

        // (Optional) If you only want .docx files and don’t care about other extensions,
        // add this check too. Otherwise remove the “if” below.
        if (!entry.name.toLowerCase().endsWith('.docx')) {
          return;
        }

        // 4) If we reach here, “entry.name” is a non-hidden .docx file.
        structure[category].push(entry.name);
        structure['All Document Templates'].push(entry.name);
      }
    });
  };

  try {
    // 5) Kick off the walk from your root “templatesDir” and give it a top-level category name.
    //    (You used 'Root' previously; keep using that if you want.)
    walk(templatesDir, 'Root');

    // 6) After the walk finishes, send back the JSON.
    res.json({ categories: structure });
  } catch (err) {
    logger.error("Failed to list categorized templates", {
      route: "GET /templates",
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Failed to list templates' });
  }
});
router.get('/esign-template', (req, res) => {
  const structure = { 'All Document Templates': [] };
 
  const walk = (dir, category) => {
    if (!structure[category]) {
      structure[category] = [];
    }
 
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
 
      if (entry.isDirectory()) {
        walk(fullPath, entry.name);
      } else {
        if (entry.name.startsWith('.')) return;
 
        // ✅ Allow .docx or .pdf
        if (!entry.name.toLowerCase().match(/\.(docx|pdf)$/)) return;
 
        structure[category].push(entry.name);
        structure['All Document Templates'].push(entry.name);
      }
    });
  };
 
  try {
    walk(templatesDirE, 'Root');
    res.json({ categories: structure });
  } catch (err) {
    console.error("Failed to list eSign templates", {
      route: "GET /esign-template",
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Failed to list eSign templates' });
  }
});

// GET /cases/:caseId/documents – list all docs for one case (recursive)
router.get("/cases/:caseId/documents", async(req, res) => {
  const caseId = req.params.caseId;
  const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseId);
  if (!fs.existsSync(caseFolder)) {
    return res.status(404).json({ message: "No documents found for this case." });
  }
   // Build a lookup of metadata from DB: key = "<folder>|<filename>"
 let metaMap = new Map();
 try {
   const [rows] = await db.promise().query(
     `SELECT filename, path, uid, uid_name, created_at
        FROM documents
       WHERE case_id = ?`,
     [caseId]
   );
   for (const r of rows) {
     const parts = (r.path || "").replace(/\\/g, "/").split("/");
     // path format: "case-documents/<caseId>/<optional folder(s)>/filename"
     const folder = parts.slice(2, -1).join("/"); // between caseId and filename
     metaMap.set(`${folder}|${r.filename}`, {
       uploaderUid:  r.uid      || null,
       uploaderName: r.uid_name || null,
       uploadedAt:   r.created_at || null,
     });
   }
 } catch (e) {
   logger.error("Failed to build document meta map", {
     route: "GET /cases/:caseId/documents",
     caseId,
     message: e.message, stack: e.stack
   });
 }
  const walkDir = (dir, parent = "") => {
    let files = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(full, path.join(parent, entry.name)));
      } else {
        if (!entry.name.startsWith('.')) {
          // files.push({ fileName: entry.name, folder: parent.replace(/\\/g, "/") });
                   const folder = parent.replace(/\\/g, "/");
         const meta   = metaMap.get(`${folder}|${entry.name}`) || {};
         files.push({
           fileName: entry.name,
           folder,
           uploaderUid:  meta.uploaderUid  ?? null,
           uploaderName: meta.uploaderName ?? null,
           uploadedAt:   meta.uploadedAt   ?? null,
         });
        }
      }
    });
    return files;
  };
  try {
    res.json({ documents: walkDir(caseFolder) });
  } catch (err) {
    logger.error("Error reading documents for case", { route: "GET /cases/:caseId/documents", caseId, message: err.message, stack: err.stack });
    res.status(500).json({ message: "Error reading documents." });
  }
});

// dynamicUpload helper (not exposed directly)
const dynamicUpload = (req, res, next) => {
  const parseForm = multer().fields([
    { name: "folder" }, { name: "name" }, { name: "description" }, { name: "assigned_date" }, { name: "tags" }, { name: "documents" }
  ]);
  parseForm(req, res, err => {
    if (err) {
      logger.error("Failed to parse upload fields in dynamicUpload", { route: "dynamicUpload", message: err.message, stack: err.stack });
      return res.status(400).json({ message: "Failed to parse upload fields." });
    }
    const caseId = req.params.caseId;
    const folder = req.body.folder || "";
    const caseFolder = path.join(DOCUMENTS_BASE_PATH, caseId, folder);
    if (!fs.existsSync(caseFolder)) fs.mkdirSync(caseFolder, { recursive: true });
    multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, caseFolder), filename: (req, file, cb) => cb(null, file.originalname) }) }).array("documents")(req, res, next);
  });
};

// POST /cases/:caseId/documents – upload new docs
router.post(
  "/cases/:caseId/documents",
  documentUpload.array("documents"),
  async (req, res, next) => {
    const userUid = req.headers["x-user-uid"];
    if (!userUid) {
      logger.error("Upload attempt missing UID", { route: "POST /cases/:caseId/documents", headers: req.headers });
      return res.status(401).json({ message: "User UID missing in request headers" });
    }
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    const [datePart, timePart] = timestamp.split(", ");
    const [m, d, y] = datePart.split("/");
    const formattedTimestamp = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")} ${timePart}`;
    const results = [];
    try {
      for (const file of req.files) {
        const fileName = file.filename;
        const filePath = path.join("case-documents", req.params.caseId, req.headers["x-folder-name"] || "", fileName).replace(/\\/g,"/");
        const uploaderName = req.body.uploader_name || null;
        const [result] = await db.promise().query(
          `INSERT INTO documents (name, filename, path, description, assigned_date, case_id, uid, uid_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?,?,?, ?, NOW(), NOW())`,
          [req.body.name, fileName, filePath, req.body.description, req.body.assigned_date, req.params.caseId,userUid,uploaderName]
        );
        await db.promise().query(
          `INSERT INTO document_activity_logs (uid, document_id, case_id, action, timestamp) VALUES (?, ?, ?, 'upload', ?)`
        , [userUid, result.insertId, req.params.caseId, formattedTimestamp]);
        results.push({ fileName, originalName: file.originalname, documentId: result.insertId });
      }
      res.json({ message: "All documents uploaded and metadata saved successfully.", uploaded: results });
    } catch (err) {
      logger.error("Error in POST /cases/:caseId/documents", { route: "POST /cases/:caseId/documents", userUid, files: req.files.map(f=>f.originalname), message: err.message, stack: err.stack });
      next(err);
    }
  }
);

// GET /documents/activity – fetch document activity logs
router.get("/documents/activity", async (req, res) => {
  const query = `SELECT dal.uid, au.first_name, au.last_name, dal.document_id, d.name AS document_name, d.filename, d.case_id, dal.action, dal.timestamp FROM document_activity_logs dal JOIN documents d ON dal.document_id = d.id JOIN active_users au ON dal.uid = au.uid ORDER BY dal.timestamp DESC`;
  try {
    const [rows] = await db.promise().query(query);
    res.json({ activities: rows });
  } catch (err) {
    logger.error("Error fetching document activity logs", { route: "GET /documents/activity", message: err.message, stack: err.stack });
    res.status(500).json({ error: "Failed to fetch document activity logs" });
  }
});

// file download & preview endpoints (no structured logging needed)
router.get("/cases/:caseId/documents/:filename", (req, res) => {
  const filePath = path.join(DOCUMENTS_BASE_PATH, req.params.caseId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  res.download(filePath);
});
router.get("/cases/:caseId/documents/:filename/view", (req, res) => {
  const filePath = path.join(DOCUMENTS_BASE_PATH, req.params.caseId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  res.sendFile(filePath);
});
router.get("/cases/:caseId/documents/:folder/:filename", (req, res) => {
  const filePath = path.join(DOCUMENTS_BASE_PATH, req.params.caseId, req.params.folder, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  if (req.query.preview === "1") {
    res.setHeader("Content-Disposition", `inline; filename=\"${req.params.filename}\"`);
    return res.sendFile(filePath);
  }
  res.download(filePath);
});
router.get("/cases/:caseId/documents/:folder/:filename/view", (req, res) => {
  const filePath = path.join(DOCUMENTS_BASE_PATH, req.params.caseId, req.params.folder, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  res.sendFile(filePath);
});

// DELETE document endpoints
router.delete("/cases/:caseId/documents/:folder/:filename", async (req, res) => {
  const { caseId, folder, filename } = req.params;
  const filePath = path.join(DOCUMENTS_BASE_PATH, caseId, folder, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  try {
    fs.unlinkSync(filePath);
    const [[row]] = await db.promise().query("SELECT id FROM documents WHERE filename = ? AND case_id = ?", [filename, caseId]);
    if (row) {
      const documentId = row.id;
      const userUid = req.headers['x-user-uid'];
      if (userUid) {
        const ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
        const [dp, tp] = ts.split(', ');
        const [mo, da, ye] = dp.split('/');
        const fmt = `${ye}-${mo.padStart(2,'0')}-${da.padStart(2,'0')} ${tp}`;
        await db.promise().query("INSERT INTO document_activity_logs (uid, document_id, case_id, action, timestamp) VALUES (?, ?, ?, 'delete', ?)", [userUid, documentId, caseId, fmt]);
      }
      await db.promise().query("DELETE FROM documents WHERE id = ?", [documentId]);
    }
    res.json({ message: "Document deleted successfully." });
  } catch (err) {
    logger.error("Error deleting document", { route: "DELETE /cases/:caseId/documents/:folder/:filename", message: err.message, stack: err.stack });
    res.status(500).json({ message: "Failed to delete document." });
  }
});
// uncategorized delete
router.delete("/cases/:caseId/documents/:filename", async (req, res) => {
  const { caseId, filename } = req.params;
  const filePath = path.join(DOCUMENTS_BASE_PATH, caseId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Document not found." });
  try {
    fs.unlinkSync(filePath);
    const [[row]] = await db.promise().query("SELECT id FROM documents WHERE filename = ? AND case_id = ?", [filename, caseId]);
    if (row) {
      const docId = row.id;
      const userUid = req.headers['x-user-uid'];
      if (userUid) {
        const ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
        const [dp, tp] = ts.split(', ');
        const [mo, da, ye] = dp.split('/');
        const fmt = `${ye}-${mo.padStart(2,'0')}-${da.padStart(2,'0')} ${tp}`;
        await db.promise().query("INSERT INTO document_activity_logs (uid, document_id, case_id, action, timestamp) VALUES (?, ?, ?, 'delete', ?)", [userUid, docId, caseId, fmt]);
      }
      await db.promise().query("DELETE FROM documents WHERE id = ?", [docId]);
    }
    res.json({ message: "Document deleted successfully." });
  } catch (err) {
    logger.error("Error deleting uncategorized document", { route: "DELETE /cases/:caseId/documents/:filename", message: err.message, stack: err.stack });
    res.status(500).json({ message: "Failed to delete document." });
  }
});

// DELETE folder – move files up and remove folder
router.delete("/cases/:caseId/folders/:folderName", async (req, res) => {
  try {
    const { caseId, folderName } = req.params;
    const decoded = decodeURIComponent(folderName);
    const folderPath = path.join(DOCUMENTS_BASE_PATH, caseId, decoded);
    if (!fs.existsSync(folderPath)) return res.status(404).json({ message: "Folder not found." });
    const files = fs.readdirSync(folderPath).filter(f => !f.startsWith('.'));
    files.forEach(file => fs.renameSync(path.join(folderPath, file), path.join(DOCUMENTS_BASE_PATH, caseId, file)));
    fs.rmdirSync(folderPath);
    res.json({ message: "Folder deleted. Documents moved to uncategorized." });
  } catch (err) {
    logger.error("Error deleting folder", { route: "DELETE /cases/:caseId/folders/:folderName", message: err.message, stack: err.stack });
    res.status(500).json({ message: "Failed to delete folder." });
  }
});

const getFolderTree = (folderPath, basePath = "") => {
  const items = fs.readdirSync(folderPath, { withFileTypes: true });
 
  return items
    .filter(item => item.isDirectory())
    .map(item => {
      const relativePath = basePath ? `${basePath}/${item.name}` : item.name;
      const fullPath = path.join(folderPath, item.name);
      return {
        name: item.name,
        path: relativePath,
        children: getFolderTree(fullPath, relativePath),
      };
    });
};
 
router.get("/cases/:caseId/folders", (req, res) => {
  const caseId = req.params.caseId;
  const casePath = path.join(DOCUMENTS_BASE_PATH, caseId);
  if (!fs.existsSync(casePath)) return res.json({ folders: [] });
 
  const folderTree = getFolderTree(casePath);
  res.json({ folders: folderTree });
});

// POST create new folder
router.post("/cases/:caseId/folders", (req, res) => {
  const caseId = req.params.caseId;
  let { name } = req.body;
 
  if (!name?.trim()) {
    return res.status(400).json({ message: "Folder name is required" });
  }
 
  // Sanitize path to prevent traversal and bad characters
  name = name
    .replace(/^(\.\.[\/\\])+/, "") // Remove leading ../ or ..\
    .replace(/[\<\>\:\*\?\"\|]/g, "_") // Replace Windows-invalid characters
    .replace(/^\//, "") // No leading slash
    .replace(/\\/g, "/"); // Normalize slashes
 
  const folderPath = path.join(DOCUMENTS_BASE_PATH, caseId, name);
 
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    res.json({ message: "Folder created", folder: name });
  } catch (err) {
    logger.error("Error creating folder", {
      route: "POST /cases/:caseId/folders",
      name,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Could not create folder" });
  }
});

// PUT move a document
router.put("/cases/:caseId/documents/:filename/move", async(req, res) => {
  try {
    const { caseId, filename } = req.params;
    const { folder: targetFolder = "", currentFolder = "" } = req.body;
    const safeFilename = decodeURIComponent(filename);
        const currentFolderPath = currentFolder ? currentFolder : "";
 
    const oldPath   = path.join(DOCUMENTS_BASE_PATH, caseId, currentFolderPath, safeFilename);
    const targetDir = path.join(DOCUMENTS_BASE_PATH, caseId, targetFolder);
    const newPath   = path.join(targetDir, safeFilename);

 

    if (!fs.existsSync(oldPath)) return res.status(404).json({ message: "Document not found" });
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    if (oldPath === newPath) return res.status(400).json({ message: "Document already in target folder" });
    if (newPath.startsWith(oldPath + path.sep)) return res.status(400).json({ message: "Cannot move a folder into itself" });
    fs.renameSync(oldPath, newPath);
    // Update the database record
    const oldRelPath = path.join("case-documents", caseId, currentFolderPath, safeFilename).replace(/\\/g, "/");
    const newRelPath = path.join("case-documents", caseId, targetFolder, safeFilename).replace(/\\/g, "/");

    await db.promise().query(
      `UPDATE documents 
       SET path = ?, updated_at = NOW() 
       WHERE case_id = ? AND filename = ? AND path = ?`,
      [newRelPath, caseId, safeFilename, oldRelPath]
    );

    res.json({ message: "Document moved", folder: targetFolder });
  } catch (err) {
    logger.error("Error moving document", { route: "PUT /cases/:caseId/documents/:filename/move", message: err.message, stack: err.stack });
    res.status(500).json({ message: err.message });
  }
});

// PUT rename folder
router.put("/cases/:caseId/folders/rename", async (req, res) => {
  const { caseId } = req.params;
  const { oldName, newName } = req.body;

  if (!oldName || !newName?.trim()) {
    return res.status(400).json({ message: "Both old and new folder names are required." });
  }

  // Sanitize new name (similar to your POST endpoint)
  const sanitizedNewName = newName
    .replace(/^(\.\.[\/\\])+/, "")
    .replace(/[\<\>\:\*\?\"\|]/g, "_")
    .replace(/^\//, "")
    .replace(/\\/g, "/");

  const casePath = path.join(DOCUMENTS_BASE_PATH, caseId);
  const oldPath = path.join(casePath, oldName);
  const newPath = path.join(path.dirname(oldPath), sanitizedNewName); // use same parent directory

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ message: "Original folder does not exist." });
  }
  if (fs.existsSync(newPath)) {
    return res.status(409).json({ message: "Target folder name already exists." });
  }

  try {
    // 1) Rename on disk
    fs.renameSync(oldPath, newPath);

    // 2) Update DB paths so metadata (uploader, timestamps) continues to match after rename
    // oldName/newName are relative to the case root. Build the prefixes exactly like stored in `documents.path`.
    const oldPrefixRel = path.join("case-documents", caseId, oldName).replace(/\\/g, "/");
    const newPrefixRel = path
      .join("case-documents", caseId, path.join(path.dirname(oldName), sanitizedNewName))
      .replace(/\\/g, "/");

    await db.promise().query(
      `UPDATE documents
         SET path = REPLACE(path, ?, ?),
             updated_at = NOW()
       WHERE case_id = ?
         AND (path = ? OR path LIKE CONCAT(?, '/%'))`,
      [oldPrefixRel, newPrefixRel, caseId, oldPrefixRel, oldPrefixRel]
    );

    res.json({ message: `Folder renamed from "${oldName}" to "${path.join(path.dirname(oldName), sanitizedNewName)}".` });
  } catch (err) {
    logger.error("Rename folder error", {
      route: "PUT /cases/:caseId/folders/rename",
      oldName,
      newName,
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ message: "Failed to rename folder." });
  }
});


router.put("/cases/:caseId/documents/rename", async (req, res) => {
  const { caseId } = req.params;
  const { oldName, newName, folder = "" } = req.body;
 
  if (!oldName || !newName?.trim()) {
    return res.status(400).json({ message: "Both old and new document names are required." });
  }
 
  const sanitizedNewName = newName
    .replace(/^(\.\.[\/\\])+/, "")
    .replace(/[\<\>\:\*\?\"\|]/g, "_")
    .replace(/^\//, "")
    .replace(/\\/g, "/");
 
  // Handle nested folders (e.g., "sub1/sub2")
  const folderParts = folder ? folder.split("/") : [];
  const folderPath = path.join(DOCUMENTS_BASE_PATH, caseId, ...folderParts);
  const oldPath = path.join(folderPath, oldName);
  const newPath = path.join(folderPath, sanitizedNewName);
 
  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ message: "Original document does not exist." });
  }
  if (fs.existsSync(newPath)) {
    return res.status(409).json({ message: "Target document name already exists." });
  }
 
  try {
    // Get the old relative path for DB query
    const oldRelPath = path.join("case-documents", caseId, folder, oldName).replace(/\\/g, "/");
    
    // 1. First get the existing document metadata from database
    const [existingDoc] = await db.promise().query(
      `SELECT uid, uid_name, created_at FROM documents 
       WHERE case_id = ? AND filename = ? AND path = ?`,
      [caseId, oldName, oldRelPath]
    );

    // 2. Rename the physical file
    fs.renameSync(oldPath, newPath);

    // 3. Calculate new relative path
    const newRelPath = path.join("case-documents", caseId, folder, sanitizedNewName).replace(/\\/g, "/");

    // 4. Update the database record
    await db.promise().query(
      `UPDATE documents 
       SET filename = ?, path = ?, updated_at = NOW()
       WHERE case_id = ? AND filename = ? AND path = ?`,
      [sanitizedNewName, newRelPath, caseId, oldName, oldRelPath]
    );

    // 5. If metadata exists, preserve it in the response
    const responseData = {
      message: `Document renamed from "${oldName}" to "${sanitizedNewName}".`,
      newName: sanitizedNewName,
      document: {
        fileName: sanitizedNewName,
        folder: folder,
        // Preserve existing metadata or set to null if not found
        uploaderUid: existingDoc[0]?.uid || null,
        uploaderName: existingDoc[0]?.uid_name || null,
        uploadedAt: existingDoc[0]?.created_at || null
      }
    };

    res.json(responseData);
  } catch (err) {
    logger.error("Rename document error", {
      route: "PUT /cases/:caseId/documents/rename",
      caseId,
      oldName,
      newName,
      folder,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Failed to rename document." });
  }
});

// ─── Chunk‐by‐chunk upload endpoints ───────────────────────────
const chunkStorage = multer.diskStorage({
  destination(req, file, cb) {
    const { fileId } = req.body;
    const dir = path.join(TEMP_UPLOADS, fileId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, `chunk_${req.body.chunkIndex}`);
  }
});
const chunkUpload = multer({ storage: chunkStorage });

// 1) Receive each chunk
router.post(
  "/cases/:caseId/documents/chunk",
  chunkUpload.single("chunk"),
  (req, res) => {
    // we wrote chunk_<index> to disk
    res.json({ received: req.body.chunkIndex });
  }
);

// 2) When all chunks are in, stitch them into one file
router.post(
  "/cases/:caseId/documents/complete",
  express.json({ limit: "1mb" }),    // small JSON payload
  async (req, res, next) => {
    try {
      const { fileId, fileName } = req.body;
      const tempDir   = path.join(TEMP_UPLOADS, fileId);
      const finalDir  = path.join(
        DOCUMENTS_BASE_PATH,
        req.params.caseId,
        req.headers["x-folder-name"] || ""
      );
      fs.mkdirSync(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, fileName);
      const out = fs.createWriteStream(finalPath);

      // read and concatenate all chunk_<n> files in order
      fs.readdirSync(tempDir)
        .filter(f => f.startsWith("chunk_"))
        .sort((a, b) => +a.split("_")[1] - +b.split("_")[1])
        .forEach(chunk => {
          out.write(fs.readFileSync(path.join(tempDir, chunk)));
          fs.unlinkSync(path.join(tempDir, chunk));
        });
      out.end();
      fs.rmdirSync(tempDir);
    // Ensure DB row exists so UI can show "added by"
    try {
      const userUid  = req.headers["x-user-uid"]  || null;
      const userName = req.body.uploader_name     || null; 
      const folder   = (req.headers["x-folder-name"] || "").replace(/\\/g, "/");
      const relPath  = path.join("case-documents", req.params.caseId, folder, fileName).replace(/\\/g, "/");

      const [existing] = await db.promise().query(
        `SELECT id FROM documents WHERE case_id=? AND filename=? AND path=? LIMIT 1`,
        [req.params.caseId, fileName, relPath]
      );
      if (existing.length === 0) {
        await db.promise().query(
          `INSERT INTO documents
             (name, filename, path, description, assigned_date, case_id, uid, uid_name, created_at, updated_at)
           VALUES (?,    ?,        ?,    ?,           ?,              ?,      ?,   ?,        NOW(),     NOW())`,
          [fileName, fileName, relPath, null, null, req.params.caseId, userUid, userName]
        );
        // (Optional) also log 'upload' to document_activity_logs as with small files
        if (userUid) {
          const ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
          const [dp, tp] = ts.split(", "); const [mo, da, ye] = dp.split("/");
          const fmt = `${ye}-${mo.padStart(2,"0")}-${da.padStart(2,"0")} ${tp}`;
          const [[row]] = await db.promise().query(
            `SELECT id FROM documents WHERE case_id=? AND filename=? AND path=? ORDER BY id DESC LIMIT 1`,
            [req.params.caseId, fileName, relPath]
          );
          if (row?.id) {
            await db.promise().query(
              `INSERT INTO document_activity_logs (uid, document_id, case_id, action, timestamp)
               VALUES (?, ?, ?, 'upload', ?)`,
              [userUid, row.id, req.params.caseId, fmt]
            );
          }
        }
      }
    } catch (metaErr) {
      logger.error("Chunk-complete metadata insert failed", {
        route: "POST /cases/:caseId/documents/complete",
        caseId: req.params.caseId, fileName,
        message: metaErr.message, stack: metaErr.stack
      });
      // do not change response; stitching succeeded
    }
      return res.json({ path: finalPath });
    } catch (err) {
      next(err);
    }
  }
);


// POST /templates/:category – upload a template to selected category
const templateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const category = req.params.category || "Root";
      const uploadPath = path.join(templatesDir, category);
      fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
});




router.post("/templates/:category", templateUpload.single("template"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No template file uploaded." });
  }
  res.json({ message: "Template uploaded successfully." });
});

// GET /templates/:category/:filename/download – download template file
router.get("/templates/:category/:filename/download", (req, res) => {
  const { category, filename } = req.params;
  const filePath = path.join(templatesDir, category, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Template not found." });
  }

  res.download(filePath);
});


const updateTemplateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const category = req.params.category || "Root";
      const uploadPath = path.join(templatesDir, category);
      fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      // Force overwrite of existing filename
      const safeName = req.params.filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.put(
  "/templates/:category/:filename",
  updateTemplateUpload.single("template"),
  (req, res) => {
    const filePath = path.join(
      templatesDir,
      req.params.category,
      req.params.filename
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Template not found." });
    }

    res.json({ message: "Template updated successfully." });
  }
);


// Delete template
router.delete('/templates/:category/:filename', (req, res) => {
  const { category, filename } = req.params;
  const filePath = path.join(templatesDir, category, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Template not found." });
  try {
    fs.unlinkSync(filePath);
    res.json({ message: "Template deleted successfully." });
  } catch (err) {
    logger.error("Error deleting template", {
      route: "DELETE /templates/:category/:filename",
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ message: "Failed to delete template." });
  }
});


// final error handler
router.use((err, req, res, next) => {
  const userUid = req.headers["x-user-uid"];
  logger.error("Documents router caught error", {
    route: `${req.method} ${req.originalUrl}`,
    userUid, message: err.message, stack: err.stack, code: err.code
  });
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ message: "One of your files is too large." });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({ message: "Internal Server Error" });
});

module.exports = router;