// routes/communications.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = twilio(accountSid, authToken);

// GET /cases/:id/communications
router.get("/:id/communications", async (req, res) => {
  const caseId = req.params.id;
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM communications WHERE case_id = ? ORDER BY created_at ASC",
      [caseId]
    );
    res.json({ communications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /cases/:id/communications
router.post("/:id/communications", async (req, res) => {
  const caseId = req.params.id;
  const { message, clientPhone } = req.body;
  if (!message || !clientPhone) {
    return res.status(400).json({ error: "Message and clientPhone are required" });
  }

  try {
    // 1) Send via Twilio
    const sms = await twilioClient.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: clientPhone
    });

    // 2) Save to DB
    const [result] = await db.promise().query(
      `INSERT INTO communications 
         (case_id, message, twilio_sid, status, direction, created_at) 
       VALUES (?, ?, ?, ?, 'outbound', NOW())`,
      [caseId, message, sms.sid, sms.status]
    );

    // 3) Fetch the inserted row
    const [[comm]] = await db.promise().query(
      "SELECT * FROM communications WHERE id = ?",
      [result.insertId]
    );

    // 4) Emit to the room so front-end sees it instantly
    const io = req.app.get("io");
    io.to(`case-${caseId}`).emit("newCommunication", comm);

    // 5) Respond with the record
    res.json({ communication: comm });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Shared inbound handler so we can support multiple webhook paths
async function handleInbound(req, res) {
  try {
    const { From, To, Body, MessageSid } = req.body || {};
    if (!From || !Body || !MessageSid) {
      return res.status(400).json({ error: "Missing required Twilio fields (From, Body, MessageSid)" });
    }

    // Optional: verify Twilio signature — if you enable this, make sure `PUBLIC_BASE_URL` matches the public domain used by Twilio (e.g., https://external-applications.louislawgroup.com)
    // const signature = req.get('x-twilio-signature');
    // const url = `${process.env.PUBLIC_BASE_URL}${req.originalUrl}`; // preserves the exact path (/sms/incoming or /twilio/inbound)
    // const isValid = twilio.validateRequest(authToken, signature, url, req.body);
    // if (!isValid) return res.status(403).json({ error: 'Invalid Twilio signature' });

    const caseId = await resolveCaseIdByPhone(db, From);

    const [result] = await db.promise().query(
      `INSERT INTO communications (case_id, message, twilio_sid, status, direction, created_at)
       VALUES (?, ?, ?, 'received', 'inbound', NOW())`,
      [caseId, Body, MessageSid]
    );

    // Fetch the inserted row to broadcast to clients in real time (if caseId is known)
    const [[comm]] = await db.promise().query("SELECT * FROM communications WHERE id = ?", [result.insertId]);

    const io = req.app.get("io");
    if (caseId) {
      io.to(`case-${caseId}`).emit("newCommunication", comm);
    } else {
      io.emit("newUnmatchedInboundCommunication", comm);
    }

    // Respond with TwiML to acknowledge receipt
    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Support both the original path and your existing Twilio-configured path
router.post("/twilio/inbound", express.urlencoded({ extended: false }), handleInbound);
router.post("/sms/incoming", express.urlencoded({ extended: false }), handleInbound);

module.exports = router;