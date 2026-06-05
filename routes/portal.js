const express       = require('express');
const router        = express.Router();
const path          = require('path');
const fs            = require('fs');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const multer        = require('multer');
const { v4: uuidv4 } = require('uuid');
const db            = require('../db');
const logger        = require('../logger');
const verifyPortalToken = require('../middleware/portalAuth');

const PORTAL_DOCS_PATH = path.join(__dirname, '..', 'portal-documents');
const CASE_DOCS_PATH   = path.join(__dirname, '..', 'case-documents');
const PORTAL_FOLDER    = 'Portal Uploads';

if (!fs.existsSync(PORTAL_DOCS_PATH)) fs.mkdirSync(PORTAL_DOCS_PATH, { recursive: true });

// Auto-create / migrate tables on startup
(async () => {
  try {
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS portal_users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name    VARCHAR(100),
        last_name     VARCHAR(100),
        case_id       VARCHAR(100) DEFAULT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS portal_documents (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        user_id          INT NOT NULL,
        case_document_id INT DEFAULT NULL,
        original_name    VARCHAR(500) NOT NULL,
        stored_name      VARCHAR(500) NOT NULL,
        stored_path      VARCHAR(1000) NOT NULL,
        size             BIGINT NOT NULL DEFAULT 0,
        mime_type        VARCHAR(255),
        uploaded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE
      )
    `);
    // Add case_document_id if table existed before this column was introduced
    await db.promise().query(`
      ALTER TABLE portal_documents ADD COLUMN case_document_id INT DEFAULT NULL
    `).catch(err => { if (err.code !== 'ER_DUP_FIELDNAME') throw err; });
  } catch (err) {
    logger.error('Portal: table init failed', { message: err.message, stack: err.stack });
  }
})();

// Multer storage:
//   - user has case_id  → case-documents/<case_id>/Portal Uploads/
//   - no case_id        → portal-documents/<user_id>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { case_id, id } = req.portalUser;
    let dest;
    if (case_id) {
      dest = path.join(CASE_DOCS_PATH, String(case_id), PORTAL_FOLDER);
    } else {
      dest = path.join(PORTAL_DOCS_PATH, String(id));
    }
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Keep original name but make it safe (same pattern as internal uploads)
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safeName);
  }
});

const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE_BYTES
  ? parseInt(process.env.MAX_FILE_SIZE_BYTES, 10)
  : 200 * 1024 * 1024;

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ─── Auth ────────────────────────────────────────────────────────────────────

// POST /portal/auth/register
router.post('/portal/auth/register', async (req, res) => {
  const { email, password, first_name, last_name, case_id } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const [[existing]] = await db.promise().query(
      'SELECT id FROM portal_users WHERE email = ?', [email]
    );
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.promise().query(
      `INSERT INTO portal_users (email, password_hash, first_name, last_name, case_id)
       VALUES (?, ?, ?, ?, ?)`,
      [email.toLowerCase().trim(), hash, first_name || null, last_name || null, case_id || null]
    );
    res.status(201).json({ id: result.insertId, email });
  } catch (err) {
    logger.error('Portal register error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /portal/auth/login
router.post('/portal/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const [[user]] = await db.promise().query(
      'SELECT id, email, password_hash, first_name, last_name, case_id FROM portal_users WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, case_id: user.case_id },
      process.env.PORTAL_JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        case_id: user.case_id
      }
    });
  } catch (err) {
    logger.error('Portal login error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Documents (all require JWT) ─────────────────────────────────────────────

// GET /portal/documents
router.get('/portal/documents', verifyPortalToken, async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT id, original_name, stored_name, size, mime_type, uploaded_at, case_document_id
         FROM portal_documents WHERE user_id = ? ORDER BY uploaded_at DESC`,
      [req.portalUser.id]
    );
    res.json({ documents: rows });
  } catch (err) {
    logger.error('Portal list documents error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// POST /portal/documents
router.post('/portal/documents', verifyPortalToken, upload.array('documents'), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });

  const { id: userId, case_id, email } = req.portalUser;

  try {
    const inserted = [];

    for (const file of req.files) {
      let storedPath;
      let caseDocumentId = null;

      if (case_id) {
        // File landed in case-documents/<case_id>/Portal Uploads/
        storedPath = path.join('case-documents', String(case_id), PORTAL_FOLDER, file.filename).replace(/\\/g, '/');

        // Insert into the main documents table so lawyers see it in the case file
        const [docResult] = await db.promise().query(
          `INSERT INTO documents (name, filename, path, description, case_id, uid, uid_name, created_at, updated_at)
           VALUES (?, ?, ?, 'Uploaded via client portal', ?, ?, ?, NOW(), NOW())`,
          [file.originalname, file.filename, storedPath, case_id, `portal_${userId}`, email]
        );
        caseDocumentId = docResult.insertId;
      } else {
        storedPath = path.join('portal-documents', String(userId), file.filename).replace(/\\/g, '/');
      }

      const [result] = await db.promise().query(
        `INSERT INTO portal_documents (user_id, case_document_id, original_name, stored_name, stored_path, size, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, caseDocumentId, file.originalname, file.filename, storedPath, file.size, file.mimetype]
      );

      inserted.push({ id: result.insertId, original_name: file.originalname });
    }

    res.status(201).json({ uploaded: inserted });
  } catch (err) {
    logger.error('Portal upload error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /portal/documents/:id/download
router.get('/portal/documents/:id/download', verifyPortalToken, async (req, res) => {
  try {
    const [[doc]] = await db.promise().query(
      'SELECT * FROM portal_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.portalUser.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // stored_path is relative to the project root
    const filePath = path.join(__dirname, '..', doc.stored_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.download(filePath, doc.original_name);
  } catch (err) {
    logger.error('Portal download error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Download failed' });
  }
});

// DELETE /portal/documents/:id
router.delete('/portal/documents/:id', verifyPortalToken, async (req, res) => {
  try {
    const [[doc]] = await db.promise().query(
      'SELECT * FROM portal_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.portalUser.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = path.join(__dirname, '..', doc.stored_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Remove from main documents table if it was linked to a case
    if (doc.case_document_id) {
      await db.promise().query('DELETE FROM documents WHERE id = ?', [doc.case_document_id]);
    }

    await db.promise().query('DELETE FROM portal_documents WHERE id = ?', [doc.id]);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    logger.error('Portal delete error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ─── Admin endpoints (protected by API key via server.js, not JWT) ───────────
// These are used by internal staff to manage client portal accounts.
// Prefix /admin/portal/ intentionally differs from /portal/ so API key middleware applies.

// GET /admin/portal/cases/:caseId/users — list portal users linked to a case
router.get('/admin/portal/cases/:caseId/users', async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT id, email, first_name, last_name, case_id, created_at
         FROM portal_users WHERE case_id = ? ORDER BY created_at DESC`,
      [req.params.caseId]
    );
    res.json({ users: rows });
  } catch (err) {
    logger.error('Admin list portal users error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to list portal users' });
  }
});

// POST /admin/portal/cases/:caseId/users — create a portal account linked to a case
router.post('/admin/portal/cases/:caseId/users', async (req, res) => {
  const { caseId } = req.params;
  try {
    // Pull clients_email + name directly from the cases table
    const [[caseRow]] = await db.promise().query(
      'SELECT clients_email, name FROM cases WHERE case_id = ?', [caseId]
    );
    if (!caseRow) return res.status(404).json({ error: 'Case not found' });

    // Allow body to override, fall back to case fields
    const email      = (req.body.email      || caseRow.clients_email || '').toLowerCase().trim();
    const first_name = req.body.first_name  || (caseRow.name ? caseRow.name.split(' ')[0] : null);
    const last_name  = req.body.last_name   || (caseRow.name ? caseRow.name.split(' ').slice(1).join(' ') : null) || null;

    if (!email) return res.status(400).json({ error: 'No email found on case and none provided in body' });

    let password = (req.body.password || '').trim();
    if (!password) {
      // Generate a password: Word-Word-#### (e.g. Tiger-Stone-4821)
      const words = ['Tiger','Stone','River','Cloud','Maple','Storm','Blaze','Cedar',
                     'Frost','Ridge','Haven','Ember','Crane','Dunes','Flint','Grove'];
      const pick = () => words[Math.floor(Math.random() * words.length)];
      password = `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const [[existing]] = await db.promise().query(
      'SELECT id FROM portal_users WHERE email = ?', [email]
    );
    if (existing) return res.status(409).json({ error: 'A portal account already exists for this email' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.promise().query(
      `INSERT INTO portal_users (email, password_hash, first_name, last_name, case_id)
       VALUES (?, ?, ?, ?, ?)`,
      [email, hash, first_name || null, last_name || null, caseId]
    );

    res.status(201).json({
      id:         result.insertId,
      email,
      password,        // plain-text — pass this to your n8n email step
      first_name,
      last_name,
      case_id:    caseId,
      portal_url: `${process.env.PUBLIC_API_BASE_URL.replace('external-applications', 'dev')}/portal/login`,
    });
  } catch (err) {
    logger.error('Admin create portal user error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to create portal user' });
  }
});

// PUT /admin/portal/users/:id/case — reassign a portal user to a different case
router.put('/admin/portal/users/:id/case', async (req, res) => {
  const { case_id } = req.body;
  try {
    await db.promise().query(
      'UPDATE portal_users SET case_id = ?, updated_at = NOW() WHERE id = ?',
      [case_id || null, req.params.id]
    );
    res.json({ message: 'Case assignment updated' });
  } catch (err) {
    logger.error('Admin update portal user case error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to update case assignment' });
  }
});

// DELETE /admin/portal/users/:id — remove a portal user entirely
router.delete('/admin/portal/users/:id', async (req, res) => {
  try {
    await db.promise().query('DELETE FROM portal_users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Portal user removed' });
  } catch (err) {
    logger.error('Admin delete portal user error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to remove portal user' });
  }
});

module.exports = router;
