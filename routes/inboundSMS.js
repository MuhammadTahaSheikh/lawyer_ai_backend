// routes/inboundSMS.js

const express = require("express");
const router = express.Router();
const db = require("../db");

// Helper: strip out everything but digits
function onlyDigits(str) {
  return (str || "").toString().replace(/\D/g, "");
}

// POST /sms/incoming — Twilio will hit this when your number receives a message
router.post("/sms/incoming", async (req, res) => {
  console.log("📥 Inbound SMS webhook payload:", req.body);

  const { From: rawFrom, Body } = req.body;
  if (!rawFrom || !Body) {
    console.error("⛔️ Missing From or Body in webhook:", req.body);
    return res.status(400).send("Missing required fields");
  }

  // Normalize: keep only digits, then last 10
  const incomingDigits = onlyDigits(rawFrom);
  const key10 = incomingDigits.slice(-10);
  console.log(`➡️  Normalized incoming = ${incomingDigits}, last10 = ${key10}`);

  try {
    // Find cases whose stored client numbers (stripped) end in those 10 digits
    const [cases] = await db.promise().query(
      `
      SELECT 
        case_id,
        clients_phone_number,
        RIGHT(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(clients_phone_number,'+','')
                  ,'-','')
                ,' ',''),'(',''),')',''),'.','')
        , 10
        ) AS db_last10
      FROM cases
      WHERE
        RIGHT(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(clients_phone_number,'+','')
                  ,'-','')
                ,' ',''),'(',''),')',''),'.','')
        , 10
        ) = ?
      `,
      [key10]
    );

    if (cases.length === 0) {
      console.warn(`⚠️ No case found for last10 = ${key10}`);
      // Twilio expects a valid XML response or it will retry
      return res.type("text/xml").send("<Response></Response>");
    }

    // For each matched case, insert and then emit over Socket.IO
    for (const { case_id } of cases) {
      const [insertResult] = await db
        .promise()
        .query(
          `
          INSERT INTO communications
            (case_id, message, direction, status, created_at)
          VALUES (?, ?, 'inbound', 'received', NOW())
          `,
          [case_id, Body]
        );

      // fetch the newly inserted record
      const [[communication]] = await db
        .promise()
        .query("SELECT * FROM communications WHERE id = ?", [insertResult.insertId]);

      // emit a real‑time update so the front‑end sees it immediately
      const io = req.app.get("io");
      io?.to(`case-${case_id}`).emit("newCommunication", communication);

      console.log(`💬 Inbound saved for case ${case_id}`, communication);
    }

    // Acknowledge to Twilio
    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    console.error("🔥 Error handling inbound SMS:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;