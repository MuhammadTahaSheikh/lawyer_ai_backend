const express = require("express");
const router = express.Router();
const db = require("../db");

const parseJsonSafe = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

router.post("/tickets", async (req, res) => {
  try {
    const {
      name,
      email,
      subject,
      issueType,
      priority,
      description,
      engineer,
      createdBy,
      attachments,
    } = req.body || {};

    if (!name || !email || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: "name, email, subject and description are required",
      });
    }

    const descriptionText = String(description).replace(/<[^>]+>/g, "").trim();
    if (!descriptionText) {
      return res.status(400).json({
        success: false,
        message: "description must include real content (not empty rich text)",
      });
    }

    const sql = `
      INSERT INTO support_tickets
      (
        name,
        email,
        subject,
        issue_type,
        priority,
        description,
        engineer_json,
        created_by_json,
        attachments_json,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name,
      email,
      subject,
      issueType || "Feature",
      priority || "Low",
      description,
      engineer ? JSON.stringify(engineer) : null,
      createdBy ? JSON.stringify(createdBy) : null,
      attachments ? JSON.stringify(attachments) : JSON.stringify([]),
      "Open",
    ];

    const [result] = await db.promise().query(sql, values);
    return res.status(201).json({
      success: true,
      message: "Ticket submitted successfully",
      ticketId: result.insertId,
    });
  } catch (error) {
    console.error("Ticket submit error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Ticket submission failed" });
  }
});

router.get("/tickets/assigned", async (req, res) => {
  try {
    const uid = req.headers["x-user-uid"] || req.query.uid;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header or uid query param.",
      });
    }

    const sql = `
      SELECT
        id,
        name,
        email,
        subject,
        issue_type,
        priority,
        description,
        engineer_json,
        created_by_json,
        attachments_json,
        status,
        created_at,
        updated_at
      FROM support_tickets
      WHERE JSON_UNQUOTE(JSON_EXTRACT(engineer_json, '$.id')) = ?
        AND status <> 'Completed'
      ORDER BY created_at DESC
    `;

    const [rows] = await db.promise().query(sql, [uid]);

    const tickets = rows.map((row) => ({
      ...row,
      engineer: parseJsonSafe(row.engineer_json, null),
      createdBy: parseJsonSafe(row.created_by_json, null),
      attachments: parseJsonSafe(row.attachments_json, []),
    }));

    return res.json({ success: true, tickets });
  } catch (error) {
    console.error("Assigned tickets fetch error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch assigned tickets" });
  }
});

router.get("/tickets/assigned/count", async (req, res) => {
  try {
    const uid = req.headers["x-user-uid"] || req.query.uid;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header or uid query param.",
      });
    }

    const sql = `
      SELECT COUNT(*) AS cnt
      FROM support_tickets
      WHERE JSON_UNQUOTE(JSON_EXTRACT(engineer_json, '$.id')) = ?
        AND status <> 'Completed'
    `;

    const [rows] = await db.promise().query(sql, [uid]);
    const count = Number(rows[0]?.cnt ?? 0);

    return res.json({ success: true, count });
  } catch (error) {
    console.error("Assigned tickets count error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to count assigned tickets" });
  }
});

router.put("/tickets/:id/status", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const uid = req.headers["x-user-uid"] || req.body?.uid;
    const { status } = req.body || {};
    const allowedStatuses = ["Open", "In Progress", "Resolved"];

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header.",
      });
    }

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${allowedStatuses.join(", ")}`,
      });
    }

    const [rows] = await db
      .promise()
      .query("SELECT engineer_json FROM support_tickets WHERE id = ? LIMIT 1", [
        ticketId,
      ]);

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const engineer = parseJsonSafe(rows[0].engineer_json, null);
    const assignedUid = engineer?.id ? String(engineer.id) : "";

    if (!assignedUid || assignedUid !== String(uid)) {
      return res.status(403).json({
        success: false,
        message: "You can only update status of tickets assigned to you.",
      });
    }

    await db
      .promise()
      .query("UPDATE support_tickets SET status = ? WHERE id = ?", [
        status,
        ticketId,
      ]);

    return res.json({
      success: true,
      message: "Ticket status updated successfully",
    });
  } catch (error) {
    console.error("Ticket status update error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update ticket status" });
  }
});

router.get("/tickets/created", async (req, res) => {
  try {
    const uid = req.headers["x-user-uid"] || req.query.uid;
    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header or uid query param.",
      });
    }

    const sql = `
      SELECT
        id,
        name,
        email,
        subject,
        issue_type,
        priority,
        description,
        engineer_json,
        created_by_json,
        attachments_json,
        status,
        created_at,
        updated_at
      FROM support_tickets
      WHERE JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?
      ORDER BY created_at DESC
    `;

    const [rows] = await db.promise().query(sql, [uid]);
    const tickets = rows.map((row) => ({
      ...row,
      engineer: parseJsonSafe(row.engineer_json, null),
      createdBy: parseJsonSafe(row.created_by_json, null),
      attachments: parseJsonSafe(row.attachments_json, []),
    }));

    return res.json({ success: true, tickets });
  } catch (error) {
    console.error("Creator tickets fetch error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tickets you created",
    });
  }
});

router.get("/tickets/created/resolved", async (req, res) => {
  try {
    const uid = req.headers["x-user-uid"] || req.query.uid;
    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header or uid query param.",
      });
    }

    const sql = `
      SELECT
        id,
        name,
        email,
        subject,
        issue_type,
        priority,
        description,
        engineer_json,
        created_by_json,
        attachments_json,
        status,
        created_at,
        updated_at
      FROM support_tickets
      WHERE JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?
        AND status = 'Resolved'
      ORDER BY updated_at DESC
    `;

    const [rows] = await db.promise().query(sql, [uid]);
    const tickets = rows.map((row) => ({
      ...row,
      engineer: parseJsonSafe(row.engineer_json, null),
      createdBy: parseJsonSafe(row.created_by_json, null),
      attachments: parseJsonSafe(row.attachments_json, []),
    }));

    return res.json({ success: true, tickets });
  } catch (error) {
    console.error("Creator resolved tickets fetch error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch resolved tickets for creator",
    });
  }
});

router.put("/tickets/:id/complete", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const uid = req.headers["x-user-uid"] || req.body?.uid;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Missing user uid. Send x-user-uid header.",
      });
    }

    const [rows] = await db.promise().query(
      "SELECT created_by_json, status FROM support_tickets WHERE id = ? LIMIT 1",
      [ticketId]
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const createdBy = parseJsonSafe(rows[0].created_by_json, null);
    const creatorUid = createdBy?.id ? String(createdBy.id) : "";

    if (!creatorUid || creatorUid !== String(uid)) {
      return res.status(403).json({
        success: false,
        message: "Only ticket creator can mark ticket as completed.",
      });
    }

    if (rows[0].status !== "Resolved") {
      return res.status(400).json({
        success: false,
        message: "Only resolved tickets can be marked completed.",
      });
    }

    await db.promise().query(
      "UPDATE support_tickets SET status = 'Completed' WHERE id = ?",
      [ticketId]
    );

    return res.json({
      success: true,
      message: "Ticket marked as completed",
    });
  } catch (error) {
    console.error("Ticket complete error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to mark ticket completed" });
  }
});

module.exports = router;
