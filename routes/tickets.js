const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  ALL_STATUSES,
  ACTIVE_STATUSES,
  parseJsonSafe,
  stripHtml,
  mapRowToTicket,
  canTransition,
  scanAttachments,
  computeSlaDates,
  computeSlaStatus,
  statusSortCase,
} = require("../services/ticketHelpers");
const {
  notifyTicketEvent,
  sendTestNotifications,
} = require("../services/ticketNotifications");

const getUid = (req) => req.headers["x-user-uid"] || req.query.uid || req.body?.uid;

const TICKET_SELECT = `
  id, name, email, subject, issue_type, priority, description,
  engineer_json, created_by_json, attachments_json, status,
  group_key, case_id, client_id, company_id, crm_link_json, template_data_json,
  first_response_at, resolved_at, sla_first_due, sla_resolve_due,
  sla_first_status, sla_resolve_status, created_at, updated_at
`;

const fetchTicketById = async (ticketId) => {
  const [rows] = await db
    .promise()
    .query(`SELECT ${TICKET_SELECT} FROM support_tickets WHERE id = ? LIMIT 1`, [
      ticketId,
    ]);
  return rows.length ? mapRowToTicket(rows[0]) : null;
};

const updateSlaStatuses = async (ticketId) => {
  const ticket = await fetchTicketById(ticketId);
  if (!ticket) return;
  const firstStatus = computeSlaStatus(ticket.sla_first_due, ticket.first_response_at);
  const resolveStatus = computeSlaStatus(ticket.sla_resolve_due, ticket.resolved_at);
  await db.promise().query(
    `UPDATE support_tickets SET sla_first_status = ?, sla_resolve_status = ? WHERE id = ?`,
    [firstStatus, resolveStatus, ticketId]
  );
};

const isAssignee = (ticket, uid) => {
  const engineer = ticket.engineer || parseJsonSafe(ticket.engineer_json, null);
  return engineer?.id && String(engineer.id) === String(uid);
};

const isCreator = (ticket, uid) => {
  const createdBy = ticket.createdBy || parseJsonSafe(ticket.created_by_json, null);
  return createdBy?.id && String(createdBy.id) === String(uid);
};

const isAgentUser = async (uid) => {
  if (!uid) return false;
  try {
    const [rows] = await db
      .promise()
      .query(
        `SELECT type, title FROM staff WHERE uid = ? LIMIT 1`,
        [uid]
      );
    if (!rows.length) return true;
    const title = String(rows[0].title || "").toLowerCase();
    const type = String(rows[0].type || "").toLowerCase();
    return (
      type === "admin" ||
      ["it manager", "developer", "devops", "taha"].includes(title)
    );
  } catch {
    return true;
  }
};

router.get("/tickets/groups", async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query(
        `SELECT group_key, label, description FROM support_groups WHERE is_active = 1 ORDER BY label`
      );
    return res.json({ success: true, groups: rows });
  } catch (error) {
    console.error("Groups fetch error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load groups" });
  }
});

router.get("/tickets/templates", async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query(
        `SELECT issue_type, label, fields_json FROM ticket_form_templates WHERE is_active = 1`
      );
    const templates = rows.map((r) => ({
      issueType: r.issue_type,
      label: r.label,
      fields: parseJsonSafe(r.fields_json, []),
    }));
    return res.json({ success: true, templates });
  } catch (error) {
    return res.json({ success: true, templates: [] });
  }
});

router.get("/tickets/dashboard", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const agent = await isAgentUser(uid);
    if (!agent) {
      return res.status(403).json({ success: false, message: "Agent access required" });
    }

    const [byStatus] = await db.promise().query(`
      SELECT status, COUNT(*) AS cnt FROM support_tickets
      WHERE status IN ('New','Open','Assigned','In Progress','Pending','Resolved')
      GROUP BY status
    `);
    const [byPriority] = await db.promise().query(`
      SELECT priority, COUNT(*) AS cnt FROM support_tickets
      WHERE status IN ('New','Open','Assigned','In Progress','Pending')
      GROUP BY priority
    `);
    const [slaBreached] = await db.promise().query(`
      SELECT COUNT(*) AS cnt FROM support_tickets
      WHERE status NOT IN ('Closed','Cancelled','Completed')
        AND (sla_first_status = 'breached' OR sla_resolve_status = 'breached')
    `);
    const [slaAtRisk] = await db.promise().query(`
      SELECT COUNT(*) AS cnt FROM support_tickets
      WHERE status NOT IN ('Closed','Cancelled','Completed')
        AND (sla_first_status = 'at_risk' OR sla_resolve_status = 'at_risk')
    `);
    const [unassigned] = await db.promise().query(`
      SELECT COUNT(*) AS cnt FROM support_tickets
      WHERE engineer_json IS NULL AND group_key IS NULL
        AND status IN ('New','Open')
    `);

    return res.json({
      success: true,
      dashboard: {
        byStatus,
        byPriority,
        slaBreached: Number(slaBreached[0]?.cnt || 0),
        slaAtRisk: Number(slaAtRisk[0]?.cnt || 0),
        unassigned: Number(unassigned[0]?.cnt || 0),
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);
    return res.status(500).json({ success: false, message: "Dashboard failed" });
  }
});

router.get("/tickets", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const agent = await isAgentUser(uid);
    if (!agent) {
      return res.status(403).json({ success: false, message: "Agent access required" });
    }

    const {
      status,
      priority,
      assigneeUid,
      requesterUid,
      groupKey,
      search,
      fromDate,
      toDate,
      page = "1",
      limit = "50",
    } = req.query;

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (priority) {
      conditions.push("priority = ?");
      params.push(priority);
    }
    if (groupKey) {
      conditions.push("group_key = ?");
      params.push(groupKey);
    }
    if (assigneeUid) {
      conditions.push(
        "JSON_UNQUOTE(JSON_EXTRACT(engineer_json, '$.id')) = ?"
      );
      params.push(assigneeUid);
    }
    if (requesterUid) {
      conditions.push(
        "JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?"
      );
      params.push(requesterUid);
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      conditions.push(
        "(subject LIKE ? OR description LIKE ? OR name LIKE ? OR email LIKE ?)"
      );
      params.push(q, q, q, q);
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (fromDate && dateRegex.test(fromDate)) {
      conditions.push("DATE(created_at) >= ?");
      params.push(fromDate);
    }
    if (toDate && dateRegex.test(toDate)) {
      conditions.push("DATE(created_at) <= ?");
      params.push(toDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const [countRows] = await db
      .promise()
      .query(`SELECT COUNT(*) AS total FROM support_tickets ${where}`, params);

    const [rows] = await db.promise().query(
      `SELECT ${TICKET_SELECT} FROM support_tickets ${where}
       ORDER BY ${statusSortCase}, created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const tickets = rows.map(mapRowToTicket);
    return res.json({
      success: true,
      tickets,
      total: Number(countRows[0]?.total || 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Queue fetch error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch tickets" });
  }
});

router.get("/tickets/notifications", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const [rows] = await db.promise().query(
      `SELECT id, ticket_id, event_type, title, body, is_read, created_at
       FROM ticket_notifications WHERE user_uid = ?
       ORDER BY created_at DESC LIMIT 50`,
      [uid]
    );
    const [unread] = await db.promise().query(
      `SELECT COUNT(*) AS cnt FROM ticket_notifications WHERE user_uid = ? AND is_read = 0`,
      [uid]
    );
    return res.json({
      success: true,
      notifications: rows,
      unreadCount: Number(unread[0]?.cnt || 0),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
});

router.patch("/tickets/notifications/read", async (req, res) => {
  try {
    const uid = getUid(req);
    const { ids, all } = req.body || {};
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    if (all) {
      await db.promise().query(
        `UPDATE ticket_notifications SET is_read = 1 WHERE user_uid = ?`,
        [uid]
      );
    } else if (Array.isArray(ids) && ids.length) {
      await db.promise().query(
        `UPDATE ticket_notifications SET is_read = 1 WHERE user_uid = ? AND id IN (?)`,
        [uid, ids]
      );
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to mark read" });
  }
});

router.get("/tickets/assigned", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const fromDate = (req.query.fromDate || req.query.date || "").trim();
    const toDate = (req.query.toDate || req.query.date || fromDate).trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    let dateClause = "";
    const params = [uid];

    if (fromDate && dateRegex.test(fromDate) && toDate && dateRegex.test(toDate)) {
      dateClause = " AND DATE(created_at) BETWEEN ? AND ?";
      params.push(fromDate, toDate);
    } else if (fromDate && dateRegex.test(fromDate)) {
      dateClause = " AND DATE(created_at) >= ?";
      params.push(fromDate);
    }

    const [rows] = await db.promise().query(
      `SELECT ${TICKET_SELECT} FROM support_tickets
       WHERE JSON_UNQUOTE(JSON_EXTRACT(engineer_json, '$.id')) = ?${dateClause}
       ORDER BY ${statusSortCase}, created_at DESC`,
      params
    );

    return res.json({ success: true, tickets: rows.map(mapRowToTicket) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch assigned tickets" });
  }
});

router.get("/tickets/assigned/count", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const activeForAssignee = ["Open", "Assigned", "In Progress", "Pending", "New"];
    const [rows] = await db.promise().query(
      `SELECT COUNT(*) AS cnt FROM support_tickets
       WHERE JSON_UNQUOTE(JSON_EXTRACT(engineer_json, '$.id')) = ?
         AND status IN (?)`,
      [uid, activeForAssignee]
    );
    return res.json({ success: true, count: Number(rows[0]?.cnt ?? 0) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to count" });
  }
});

router.get("/tickets/assigned/attention", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const assigneeMatch = `JSON_UNQUOTE(JSON_EXTRACT(st.engineer_json, '$.id')) = ?`;

    const [countRows] = await db.promise().query(
      `SELECT COUNT(*) AS cnt
       FROM ticket_notifications tn
       INNER JOIN support_tickets st ON st.id = tn.ticket_id
       WHERE tn.user_uid = ? AND tn.is_read = 0 AND ${assigneeMatch}
         AND tn.event_type IN ('ticket_created', 'ticket_assigned', 'status_changed')`,
      [uid, uid]
    );

    const [commentRows] = await db.promise().query(
      `SELECT DISTINCT tn.ticket_id
       FROM ticket_notifications tn
       INNER JOIN support_tickets st ON st.id = tn.ticket_id
       WHERE tn.user_uid = ? AND tn.is_read = 0
         AND tn.event_type = 'comment_added'
         AND ${assigneeMatch}`,
      [uid, uid]
    );

    return res.json({
      success: true,
      count: Number(countRows[0]?.cnt ?? 0),
      commentTicketIds: commentRows.map((r) => Number(r.ticket_id)),
    });
  } catch (error) {
    console.error("Assigned attention fetch error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch attention" });
  }
});

router.post("/tickets/assigned/attention/view", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const { ticketId } = req.body || {};
    const assigneeMatch = `JSON_UNQUOTE(JSON_EXTRACT(st.engineer_json, '$.id')) = ?`;

    if (ticketId) {
      await db.promise().query(
        `UPDATE ticket_notifications tn
         INNER JOIN support_tickets st ON st.id = tn.ticket_id
         SET tn.is_read = 1
         WHERE tn.user_uid = ? AND tn.ticket_id = ? AND tn.is_read = 0
           AND tn.event_type = 'comment_added' AND ${assigneeMatch}`,
        [uid, ticketId, uid]
      );
    } else {
      await db.promise().query(
        `UPDATE ticket_notifications tn
         INNER JOIN support_tickets st ON st.id = tn.ticket_id
         SET tn.is_read = 1
         WHERE tn.user_uid = ? AND tn.is_read = 0 AND ${assigneeMatch}
           AND tn.event_type IN ('ticket_created', 'ticket_assigned', 'status_changed')`,
        [uid, uid]
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Assigned attention dismiss error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to dismiss attention" });
  }
});

router.get("/tickets/created/attention", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const creatorMatch = `JSON_UNQUOTE(JSON_EXTRACT(st.created_by_json, '$.id')) = ?`;

    const [commentRows] = await db.promise().query(
      `SELECT DISTINCT tn.ticket_id
       FROM ticket_notifications tn
       INNER JOIN support_tickets st ON st.id = tn.ticket_id
       WHERE tn.user_uid = ? AND tn.is_read = 0
         AND tn.event_type = 'comment_added'
         AND ${creatorMatch}`,
      [uid, uid]
    );

    return res.json({
      success: true,
      count: commentRows.length,
      commentTicketIds: commentRows.map((r) => Number(r.ticket_id)),
    });
  } catch (error) {
    console.error("Created attention fetch error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch attention" });
  }
});

router.post("/tickets/created/attention/view", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const { ticketId } = req.body || {};
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "ticketId required" });
    }

    const creatorMatch = `JSON_UNQUOTE(JSON_EXTRACT(st.created_by_json, '$.id')) = ?`;

    await db.promise().query(
      `UPDATE ticket_notifications tn
       INNER JOIN support_tickets st ON st.id = tn.ticket_id
       SET tn.is_read = 1
       WHERE tn.user_uid = ? AND tn.ticket_id = ? AND tn.is_read = 0
         AND tn.event_type = 'comment_added' AND ${creatorMatch}`,
      [uid, ticketId, uid]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Created attention dismiss error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to dismiss attention" });
  }
});

router.get("/tickets/created", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const fromDate = (req.query.fromDate || "").trim();
    const toDate = (req.query.toDate || fromDate).trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    let dateClause = "";
    const params = [uid];

    if (fromDate && dateRegex.test(fromDate) && toDate && dateRegex.test(toDate)) {
      dateClause = " AND DATE(created_at) BETWEEN ? AND ?";
      params.push(fromDate, toDate);
    }

    const [rows] = await db.promise().query(
      `SELECT ${TICKET_SELECT} FROM support_tickets
       WHERE JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?${dateClause}
       ORDER BY ${statusSortCase}, created_at DESC`,
      params
    );

    return res.json({ success: true, tickets: rows.map(mapRowToTicket) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch created tickets" });
  }
});

router.get("/tickets/created/resolved/count", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const [rows] = await db.promise().query(
      `SELECT COUNT(*) AS cnt FROM support_tickets
       WHERE JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?
         AND status = 'Resolved'`,
      [uid]
    );
    return res.json({ success: true, count: Number(rows[0]?.cnt ?? 0) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to count" });
  }
});

router.get("/tickets/created/resolved", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const [rows] = await db.promise().query(
      `SELECT ${TICKET_SELECT} FROM support_tickets
       WHERE JSON_UNQUOTE(JSON_EXTRACT(created_by_json, '$.id')) = ?
         AND status = 'Resolved'
       ORDER BY updated_at DESC`,
      [uid]
    );
    return res.json({ success: true, tickets: rows.map(mapRowToTicket) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch resolved tickets" });
  }
});

router.get("/tickets/:id", async (req, res) => {
  try {
    const ticket = await fetchTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch ticket" });
  }
});

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
      groupKey,
      createdBy,
      attachments,
      caseId,
      clientId,
      companyId,
      crmLink,
      templateData,
    } = req.body || {};

    if (!name || !email || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: "name, email, subject and description are required",
      });
    }

    if (!stripHtml(description)) {
      return res.status(400).json({
        success: false,
        message: "description must include real content",
      });
    }

    const safeAttachments = await scanAttachments(attachments || []);
    const initialStatus = engineer || groupKey ? "Assigned" : "New";
    const sla = computeSlaDates(priority || "Low");

    const sql = `
      INSERT INTO support_tickets (
        name, email, subject, issue_type, priority, description,
        engineer_json, created_by_json, attachments_json, status,
        group_key, case_id, client_id, company_id, crm_link_json, template_data_json,
        sla_first_due, sla_resolve_due
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(safeAttachments),
      initialStatus,
      groupKey || null,
      caseId || null,
      clientId || null,
      companyId || null,
      crmLink ? JSON.stringify(crmLink) : null,
      templateData ? JSON.stringify(templateData) : null,
      sla.sla_first_due,
      sla.sla_resolve_due,
    ];

    const [result] = await db.promise().query(sql, values);
    const ticketId = result.insertId;
    const ticket = await fetchTicketById(ticketId);

    await notifyTicketEvent({
      ticket: { ...ticket, id: ticketId },
      eventType: "ticket_created",
      actorUid: createdBy?.id,
    });

    return res.status(201).json({
      success: true,
      message: "Ticket submitted successfully",
      ticketId,
    });
  } catch (error) {
    console.error("Ticket submit error:", error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "Ticket submission failed",
    });
  }
});

router.patch("/tickets/bulk", async (req, res) => {
  try {
    const uid = getUid(req);
    const { ticketIds, status, priority, engineer, groupKey } = req.body || {};
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    if (!Array.isArray(ticketIds) || !ticketIds.length) {
      return res.status(400).json({ success: false, message: "ticketIds required" });
    }
    const agent = await isAgentUser(uid);
    if (!agent) {
      return res.status(403).json({ success: false, message: "Agent access required" });
    }

    let updated = 0;
    for (const id of ticketIds) {
      const ticket = await fetchTicketById(id);
      if (!ticket) continue;

      const updates = [];
      const params = [];

      if (status && canTransition(ticket.status, status)) {
        updates.push("status = ?");
        params.push(status);
        if (status === "Resolved") {
          updates.push("resolved_at = COALESCE(resolved_at, NOW())");
        }
        if (["Closed", "Completed"].includes(status)) {
          updates.push("resolved_at = COALESCE(resolved_at, NOW())");
        }
      }
      if (priority) {
        updates.push("priority = ?");
        params.push(priority);
      }
      if (engineer !== undefined) {
        updates.push("engineer_json = ?");
        params.push(engineer ? JSON.stringify(engineer) : null);
        if (engineer && ticket.status === "New") {
          updates.push("status = 'Assigned'");
        }
      }
      if (groupKey !== undefined) {
        updates.push("group_key = ?");
        params.push(groupKey || null);
      }

      if (!updates.length) continue;
      params.push(id);
      await db.promise().query(
        `UPDATE support_tickets SET ${updates.join(", ")} WHERE id = ?`,
        params
      );
      await updateSlaStatuses(id);
      updated += 1;

      if (status) {
        const updatedTicket = await fetchTicketById(id);
        await notifyTicketEvent({
          ticket: updatedTicket,
          eventType: "status_changed",
          actorUid: uid,
        });
      }
    }

    return res.json({ success: true, updated });
  } catch (error) {
    console.error("Bulk update error:", error.message);
    return res.status(500).json({ success: false, message: "Bulk update failed" });
  }
});

router.put("/tickets/:id/status", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const uid = getUid(req);
    const { status } = req.body || {};

    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    if (!status || !ALL_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${ALL_STATUSES.join(", ")}`,
      });
    }

    const ticket = await fetchTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    const assignee = isAssignee(ticket, uid);
    const creator = isCreator(ticket, uid);
    const agent = await isAgentUser(uid);

    if (!assignee && !agent && !(creator && ["Closed", "Completed"].includes(status))) {
      return res.status(403).json({ success: false, message: "Not allowed to update status" });
    }

    if (!canTransition(ticket.status, status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${ticket.status} to ${status}`,
      });
    }

    const extras = [];
    if (["In Progress", "Assigned"].includes(status) && !ticket.first_response_at) {
      extras.push("first_response_at = NOW()");
    }
    if (status === "Resolved") {
      extras.push("resolved_at = COALESCE(resolved_at, NOW())");
    }
    if (["Closed", "Completed"].includes(status)) {
      extras.push("resolved_at = COALESCE(resolved_at, NOW())");
    }

    await db.promise().query(
      `UPDATE support_tickets SET status = ?${extras.length ? ", " + extras.join(", ") : ""} WHERE id = ?`,
      [status, ticketId]
    );
    await updateSlaStatuses(ticketId);

    const updatedTicket = await fetchTicketById(ticketId);
    await notifyTicketEvent({
      ticket: updatedTicket,
      eventType: status === "Resolved" ? "ticket_resolved" : "status_changed",
      actorUid: uid,
    });

    return res.json({ success: true, message: "Ticket status updated" });
  } catch (error) {
    console.error("Status update error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to update status" });
  }
});

router.put("/tickets/:id/assign", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const uid = getUid(req);
    const { engineer, groupKey } = req.body || {};

    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    const agent = await isAgentUser(uid);
    const assignee = isAssignee(ticket, uid);
    const creator = isCreator(ticket, uid);
    if (!agent && !assignee && !creator) {
      return res.status(403).json({
        success: false,
        message: "Only the assignee, ticket creator, or IT staff can reassign this ticket.",
      });
    }

    const prevAssigneeId = ticket.engineer?.id ? String(ticket.engineer.id) : "";
    const nextAssigneeId = engineer?.id ? String(engineer.id) : "";
    const terminal = ["Resolved", "Closed", "Completed", "Cancelled"];

    let newStatus = ticket.status;
    if (engineer && nextAssigneeId && nextAssigneeId !== prevAssigneeId) {
      if (!terminal.includes(ticket.status)) {
        newStatus = "Assigned";
      }
    } else if (["New", "Open"].includes(ticket.status) && (engineer || groupKey)) {
      newStatus = "Assigned";
    }

    await db.promise().query(
      `UPDATE support_tickets SET engineer_json = ?, group_key = ?, status = ? WHERE id = ?`,
      [
        engineer ? JSON.stringify(engineer) : null,
        groupKey || null,
        newStatus,
        ticketId,
      ]
    );

    const updatedTicket = await fetchTicketById(ticketId);
    if (engineer?.id) {
      await notifyTicketEvent({
        ticket: updatedTicket,
        eventType: "ticket_assigned",
        actorUid: uid,
      });
    } else {
      await notifyTicketEvent({
        ticket: updatedTicket,
        eventType: "status_changed",
        actorUid: uid,
      });
    }

    return res.json({ success: true, message: "Assignment updated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Assignment failed" });
  }
});

router.put("/tickets/:id/complete", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }

    const ticket = await fetchTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }
    if (!isCreator(ticket, uid)) {
      return res.status(403).json({
        success: false,
        message: "Only ticket creator can close the ticket.",
      });
    }
    if (ticket.status !== "Resolved") {
      return res.status(400).json({
        success: false,
        message: "Only resolved tickets can be marked completed.",
      });
    }

    await db.promise().query(
      `UPDATE support_tickets SET status = 'Closed', resolved_at = COALESCE(resolved_at, NOW()) WHERE id = ?`,
      [ticketId]
    );
    await updateSlaStatuses(ticketId);

    return res.json({ success: true, message: "Ticket closed" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to close ticket" });
  }
});

router.get("/tickets/:id/comments", async (req, res) => {
  try {
    const uid = getUid(req);
    const ticketId = req.params.id;
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    const agent = uid ? await isAgentUser(uid) : false;
    const internalOnly = req.query.internal === "1" && agent;

    let sql = `SELECT id, ticket_id, author_json, body, is_internal, parent_comment_id, created_at, updated_at
               FROM ticket_comments WHERE ticket_id = ?`;
    const params = [ticketId];

    if (internalOnly) {
      sql += " AND is_internal = 1";
    } else {
      sql += " AND is_internal = 0";
    }
    sql += " ORDER BY created_at ASC";

    const [rows] = await db.promise().query(sql, params);
    const comments = rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      author: parseJsonSafe(r.author_json, {}),
      body: r.body,
      isInternal: !!r.is_internal,
      parentCommentId: r.parent_comment_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return res.json({ success: true, comments });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load comments" });
  }
});

router.post("/tickets/:id/comments", async (req, res) => {
  try {
    const uid = getUid(req);
    const ticketId = req.params.id;
    const { body, isInternal, parentCommentId, author } = req.body || {};

    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    if (!stripHtml(body)) {
      return res.status(400).json({ success: false, message: "Comment body required" });
    }

    const ticket = await fetchTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    const agent = await isAgentUser(uid);
    const internal = !!isInternal;
    if (internal && !agent) {
      return res.status(403).json({ success: false, message: "Internal notes require agent role" });
    }

    const authorJson = {
      ...(author && typeof author === "object" ? author : {}),
      id: author?.id || uid,
      name: author?.name || "User",
      email: author?.email || "",
    };

    const [result] = await db.promise().query(
      `INSERT INTO ticket_comments (ticket_id, author_json, body, is_internal, parent_comment_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        ticketId,
        JSON.stringify(authorJson),
        body,
        internal ? 1 : 0,
        parentCommentId || null,
      ]
    );

    if (!ticket.first_response_at && agent) {
      await db.promise().query(
        `UPDATE support_tickets SET first_response_at = NOW() WHERE id = ?`,
        [ticketId]
      );
      await updateSlaStatuses(ticketId);
    }

    const updatedTicket = await fetchTicketById(ticketId);
    if (!internal) {
      const commentPreview = stripHtml(body).slice(0, 240);
      await notifyTicketEvent({
        ticket: updatedTicket,
        eventType: "comment_added",
        actorUid: uid,
        extra: { commentPreview },
      });
    }

    return res.status(201).json({
      success: true,
      commentId: result.insertId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to add comment" });
  }
});

router.post("/tickets/notifications/test", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) {
      return res.status(400).json({ success: false, message: "Missing user uid" });
    }
    const { email } = req.body || {};
    const result = await sendTestNotifications(email);
    return res.json({
      success: true,
      message: "Test notifications dispatched. Check Teams, inbox, and n8n execution log.",
      configured: {
        teams: Boolean(process.env.TEAMS_WEBHOOK_URL),
        emailWebhook: Boolean(process.env.TICKET_EMAIL_WEBHOOK_URL),
        n8n: Boolean(
          process.env.N8N_TICKET_WEBHOOK_URL || process.env.N8N_TICKET_NOTIFY_URL
        ),
        appUrl: process.env.TICKET_APP_URL || process.env.CMS_APP_URL || "(default cms)",
      },
      results: result.results,
    });
  } catch (error) {
    console.error("Notification test error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
