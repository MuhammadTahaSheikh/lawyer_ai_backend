// routes/eSign.js
const express = require("express");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");
const jwt     = require("jsonwebtoken");
const router  = express.Router();
require("dotenv").config();

const API_KEY             = process.env.DOCUSEAL_API_KEY;
const DOCUMENTS_BASE_PATH = path.join(__dirname, "..", "case-documents");

if (!API_KEY) throw new Error("Missing DOCUSEAL_API_KEY in .env");

// parse JSON bodies
router.use(express.json());

// 1) Builder token
router.post("/builder_token", (req, res) => {
  const { case_id } = req.body;
  if (!case_id) return res.status(400).json({ error: "Missing case_id" });

  const payload = {
    user_email:  "ymesa@louislawgroup.com",
    name:        `E-Sign Template for Case ${case_id}`,
    external_id: String(case_id),
    metadata:    { case_id },
    document_urls: []
  };

  const token = jwt.sign(payload, API_KEY, { algorithm: "HS256" });
  res.json({ token });
});

// 2) Ad-hoc submission
router.post("/submission", async (req, res) => {
  const { case_id, document_url, email, role = "Signer" } = req.body;
  if (!case_id || !document_url || !email) {
    return res.status(400).json({ error: "Missing case_id, document_url or email" });
  }

  try {
    const payload = {
      document_url,
      external_id: String(case_id),
      metadata:    { case_id },
      submitters:  [{ email, role }],
      send_email:  true
    };

    const resp = await axios.post(
      `https://api.docuseal.com/v1/submissions`,
      payload,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    const submission = resp.data.submitters?.[0];
    if (!submission?.submission_id) {
      throw new Error("No submission_id returned");
    }
    res.json({ submission_id: submission.submission_id });
  } catch (err) {
    console.error("DocuSeal submission error:", err.response?.data || err.message);
    res.status(err.response?.status || 500)
       .json({ error: err.response?.data || err.message });
  }
});

// 3) DocuSeal webhook
router.post("/webhook", async (req, res) => {
  console.log("🔔 DocuSeal webhook hit:", req.body);

  const eventType = req.body.event_type || req.body.event;
  const data      = req.body.data || {};

  // Extract case ID via external_id or metadata
  const caseId =
    (data.template?.external_id) ||
    String(data.template?.external_id) ||
    data.external_id ||
    req.body.metadata?.case_id ||
    data.submission?.metadata?.case_id ||
    data.metadata?.case_id;

  console.log("🔑 Extracted caseId:", caseId);

  if (eventType === "form.completed" && caseId) {
    try {
      const docs = data.documents || [];
      if (docs.length) {
        // download each document URL
        for (const doc of docs) {
          const url = doc.url;
          // download stream
          const pdfStream = await axios.get(url, { responseType: "stream" });

          // ensure folder
          const targetDir = path.join(DOCUMENTS_BASE_PATH, String(caseId));
          await fs.promises.mkdir(targetDir, { recursive: true });

          // filename
          const filename = doc.filename || `signed-${data.submission_id}.pdf`;
          const outPath = path.join(targetDir, filename);

          await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(outPath);
            pdfStream.data.pipe(ws);
            ws.on("finish", resolve);
            ws.on("error", reject);
          });
          console.log(`✅ Saved signed PDF to ${outPath}`);
        }
      } else {
        console.warn("⚠️ No documents array in webhook payload; nothing to download.");
      }
    } catch (err) {
      console.error("❌ Webhook handler error:", err.response?.data || err.message);
    }
  }
  res.sendStatus(200);
});

module.exports = router;
