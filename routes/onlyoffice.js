// routes/onlyoffice.js
const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

const OO_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET; // <- set this
const OO_JWT_ALG = process.env.ONLYOFFICE_JWT_ALG || 'HS256';

if (!OO_JWT_SECRET) {
  console.warn('[onlyoffice] ONLYOFFICE_JWT_SECRET is not set. Token signing will fail.');
}

// Sign embed payload and return { token }
router.post('/embed-token', express.json(), (req, res) => {
  try {
    const payload = req.body || {};
    if (!OO_JWT_SECRET) return res.status(500).json({ message: 'ONLYOFFICE_JWT_SECRET not set' });

    // Sign the ENTIRE config you send from the client (document, editorConfig, etc.)
    const token = jwt.sign(payload, OO_JWT_SECRET, { algorithm: OO_JWT_ALG });
    return res.json({ token });
  } catch (e) {
    console.error('[onlyoffice] embed-token error:', e);
    return res.status(500).json({ message: 'Failed to sign token' });
  }
});

module.exports = router;