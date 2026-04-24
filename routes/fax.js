// routes/fax.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../db");
const logger = require("../logger");
const path = require("path");
const fs = require("fs");

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_FAX_FROM = process.env.TELNYX_FAX_FROM_NUMBER;
const PUBLIC_BASE_URL = process.env.PUBLIC_API_BASE_URL; // https://dev.louislawgroup.com
const STORAGE_ROOT = process.env.STORAGE_ROOT;

// ─── POST /fax/send ─────────────────────────────────────────────────────────
// Send a fax for a specific case document
// Body: { case_id, document_name, recipient_fax_number, folder_name? }
// Headers: x-user-uid, x-user-name (optional)
router.post("/send", async (req, res) => {
  const { case_id, document_name, recipient_fax_number, folder_name } = req.body;
  const sentByUid = req.headers["x-user-uid"] || null;
  const sentByName = req.headers["x-user-name"] || null;

  if (!case_id || !document_name || !recipient_fax_number) {
    return res.status(400).json({
      error: "case_id, document_name, and recipient_fax_number are required",
    });
  }

  // Build file path and verify document exists
  const relativePath = folder_name
    ? path.join(case_id, folder_name, document_name)
    : path.join(case_id, document_name);
  const fullPath = path.join(STORAGE_ROOT, relativePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Document not found on server" });
  }

  // Public URL that Telnyx will fetch the document from
  const mediaUrl = `${PUBLIC_BASE_URL}/case-documents/${encodeURIComponent(relativePath.replace(/\\/g, "/"))}`;

  try {
    // Call Telnyx Programmable Fax API
    const telnyxResponse = await axios.post(
      "https://api.telnyx.com/v2/faxes",
      {
        connection_id: "", // will use default fax app
        media_url: mediaUrl,
        to: recipient_fax_number,
        from: TELNYX_FAX_FROM,
        quality: "high",
      },
      {
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const faxData = telnyxResponse.data?.data;
    const telnyxFaxId = faxData?.id || null;
    const faxStatus = faxData?.status || "queued";

    // Save to fax_logs
    const [result] = await db.promise().query(
      `INSERT INTO fax_logs
         (case_id, document_name, document_path, recipient_fax_number, telnyx_fax_id, status, direction, sent_by_uid, sent_by_name)
       VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?)`,
      [case_id, document_name, relativePath, recipient_fax_number, telnyxFaxId, faxStatus, sentByUid, sentByName]
    );

    const [[faxLog]] = await db.promise().query(
      "SELECT * FROM fax_logs WHERE id = ?",
      [result.insertId]
    );

    // Emit real-time update to case room
    const io = req.app.get("io");
    io.to(`case-${case_id}`).emit("faxSent", faxLog);

    // Log activity
    await db.promise().query(
      `INSERT INTO case_activity_logs (uid, case_id, action, field_name, new_value, timestamp)
       VALUES (?, ?, 'Fax Sent', 'fax', ?, NOW())`,
      [sentByUid, case_id, `Faxed "${document_name}" to ${recipient_fax_number}`]
    );

    logger.info("Fax sent successfully", {
      case_id,
      document_name,
      recipient_fax_number,
      telnyx_fax_id: telnyxFaxId,
    });

    res.json({ success: true, fax: faxLog });
  } catch (err) {
    logger.error("Failed to send fax", {
      case_id,
      document_name,
      recipient_fax_number,
      error: err.response?.data || err.message,
    });

    // Still log the failed attempt
    await db.promise().query(
      `INSERT INTO fax_logs
         (case_id, document_name, document_path, recipient_fax_number, status, direction, error_message, sent_by_uid, sent_by_name)
       VALUES (?, ?, ?, ?, 'failed', 'outbound', ?, ?, ?)`,
      [case_id, document_name, relativePath, recipient_fax_number, err.response?.data?.errors?.[0]?.detail || err.message, sentByUid, sentByName]
    );

    res.status(500).json({
      error: "Failed to send fax",
      details: err.response?.data || err.message,
    });
  }
});

// ─── GET /fax/case/:caseId ──────────────────────────────────────────────────
// Get all fax logs for a specific case
router.get("/case/:caseId", async (req, res) => {
  const { caseId } = req.params;
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM fax_logs WHERE case_id = ? ORDER BY created_at DESC",
      [caseId]
    );
    res.json({ success: true, faxes: rows });
  } catch (err) {
    logger.error("Failed to fetch fax logs", { case_id: caseId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /fax/:id ───────────────────────────────────────────────────────────
// Get a single fax log by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [[fax]] = await db.promise().query(
      "SELECT * FROM fax_logs WHERE id = ?",
      [id]
    );
    if (!fax) return res.status(404).json({ error: "Fax log not found" });
    res.json({ success: true, fax });
  } catch (err) {
    logger.error("Failed to fetch fax log", { id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /fax/webhook ─────────────────────────────────────────────────────
// Telnyx sends fax status updates here
// Events: fax.queued, fax.media.processed, fax.sending.started, fax.delivered, fax.failed
router.post("/webhook", async (req, res) => {
  try {
    const event = req.body?.data;
    if (!event) {
      return res.status(400).json({ error: "No event data" });
    }

    const eventType = event.event_type || req.body?.meta?.event_type;
    const faxId = event.payload?.fax_id || event.payload?.id;
    const status = mapTelnyxStatus(eventType);
    const pagesSent = event.payload?.page_count || 0;
    const failureReason = event.payload?.failure_reason || null;

    logger.info("Telnyx fax webhook received", {
      event_type: eventType,
      fax_id: faxId,
      status,
    });

    if (!faxId) {
      return res.status(200).json({ received: true, message: "No fax_id in payload" });
    }

    // Update the fax log
    await db.promise().query(
      `UPDATE fax_logs
       SET status = ?, pages_sent = ?, error_message = COALESCE(?, error_message)
       WHERE telnyx_fax_id = ?`,
      [status, pagesSent, failureReason, faxId]
    );

    // Fetch updated record to emit via socket
    const [[updatedFax]] = await db.promise().query(
      "SELECT * FROM fax_logs WHERE telnyx_fax_id = ?",
      [faxId]
    );

    if (updatedFax) {
      const io = req.app.get("io");
      io.to(`case-${updatedFax.case_id}`).emit("faxStatusUpdate", updatedFax);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error("Fax webhook error", { error: err.message, body: req.body });
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /fax/:id ────────────────────────────────────────────────────────
// Delete a fax log entry
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.promise().query(
      "DELETE FROM fax_logs WHERE id = ?",
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Fax log not found" });
    }
    res.json({ success: true, message: "Fax log deleted" });
  } catch (err) {
    logger.error("Failed to delete fax log", { id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Map Telnyx event types to simple status ────────────────────────
function mapTelnyxStatus(eventType) {
  const statusMap = {
    "fax.queued": "queued",
    "fax.media.processed": "processing",
    "fax.sending.started": "sending",
    "fax.delivered": "delivered",
    "fax.failed": "failed",
    "fax.received": "received",
  };
  return statusMap[eventType] || eventType || "unknown";
}

module.exports = router;
