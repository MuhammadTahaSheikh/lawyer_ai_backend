const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const db = require("../db");
 
 
router.get("/companies", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const sort = req.query.sort || "created_at DESC";
 
  const conditions = [];
  const values = [];
 
  if (search) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
 
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countQuery = `SELECT COUNT(*) AS total FROM company ${whereClause}`;
  const companiesQuery = `
    SELECT * FROM company
    ${whereClause}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `;
 
  db.query(countQuery, values, (err, countResult) => {
    if (err) return res.status(500).send("Error counting companies.");
    const total = countResult[0]?.total || 0;
 
    db.query(companiesQuery, [...values, limit, offset], (err, companies) => {
      if (err) return res.status(500).send("Error fetching companies.");
 
      if (!companies.length) {
        return res.json({ total, companies: [] });
      }
 
      const companyIds = companies.map(c => c.id);
      const companyNames = companies.map(c => c.name);
      const idPlaceholders = companyIds.map(() => '?').join(',');
      const namePlaceholders = companyNames.map(() => '?').join(',');
 
      // --- Fetch all cases ---
      const casesQuery = `
        SELECT cc.company_id, cs.case_id, cs.name
        FROM company_case cc
        JOIN cases cs ON cc.case_id = cs.case_id
        WHERE cc.company_id IN (${idPlaceholders})
      `;
 
      db.query(casesQuery, companyIds, (err, caseResults = []) => {
        if (err) return res.status(500).send("Error fetching cases.");
 
        const groupedCases = {};
        for (const row of caseResults) {
          if (!groupedCases[row.company_id]) groupedCases[row.company_id] = [];
          groupedCases[row.company_id].push({ id: row.case_id, name: row.name });
        }
 
        // --- Fetch all clients from both sources ---
        const clientQuery = `
          SELECT
            c.id AS client_id,
            c.first_name,
            c.last_name,
            c.email,
            c.cell_phone_number,
            cc.company_id AS linked_company_id,
            cmp.id AS matched_company_id
          FROM client c
          LEFT JOIN company_client cc ON c.id = cc.client_id
          LEFT JOIN company cmp ON c.company = cmp.name
          WHERE cc.company_id IN (${idPlaceholders}) OR c.company IN (${namePlaceholders})
        `;
 
        db.query(clientQuery, [...companyIds, ...companyNames], (err, clientResults = []) => {
          if (err) return res.status(500).send("Error fetching clients.");
 
          const groupedClients = {};
 
          for (const client of clientResults) {
            const companyId = client.linked_company_id || client.matched_company_id;
            if (!companyId) continue;
 
            if (!groupedClients[companyId]) groupedClients[companyId] = [];
 
            // Prevent duplicates
            const exists = groupedClients[companyId].some(c => c.id === client.client_id);
            if (!exists) {
              groupedClients[companyId].push({
                id: client.client_id,
                first_name: client.first_name,
                last_name: client.last_name,
                name: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
                email: client.email,
                phone: client.cell_phone_number
              });
            }
          }
 
          // Final company response
          const finalCompanies = companies.map(c => ({
            ...c,
            cases: groupedCases[c.id] || [],
            clients: groupedClients[c.id] || []
          }));
 
          res.json({ total, companies: finalCompanies });
        });
      });
    });
  });
});
 
 
 
 
 
 
// GET /companies/names - Return all company names for dropdowns
router.get("/companies/names", (req, res) => {
  const search = req.query.search || "";
  const searchClause = search ? "WHERE name LIKE ?" : "";
  const values = search ? [`%${search}%`] : [];
 
  const query = `
    SELECT id, name
    FROM company
    ${searchClause}
    ORDER BY name ASC
  `;
 
  db.query(query, values, (err, results) => {
    if (err) return res.status(500).send("Error fetching company names.");
    res.json(results);
  });
});


// GET /companies/:id/notes - Paginated notes across all linked cases
router.get("/companies/:id/notes", async (req, res) => {
  const companyId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const caseIdsFromQuery = String(req.query.case_ids || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    let caseIds = caseIdsFromQuery;
    if (!caseIds.length) {
      const [linkedCases] = await db.promise().query(
        "SELECT case_id FROM company_case WHERE company_id = ?",
        [companyId]
      );
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.json({ caseNotes: [], totalNotes: 0, page, limit });
    }

    const placeholders = caseIds.map(() => "?").join(",");

    const [rows] = await db.promise().query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        cn.id,
        cn.case_id,
        cn.subject,
        cn.note,
        cn.date,
        cn.created_at AS createdAt,
        cn.updated_at AS updatedAt,
        CONCAT(au1.first_name, ' ', au1.last_name) AS createdBy,
        CONCAT(au2.first_name, ' ', au2.last_name) AS updatedBy,
        CONCAT(s1.first_name, ' ', s1.last_name)   AS createdByStaff,
        CONCAT(s2.first_name, ' ', s2.last_name)   AS updatedByStaff,
        cs.name AS case_name
      FROM case_notes_record cn
      LEFT JOIN active_users au1 ON cn.created_by_id = au1.staff_id
      LEFT JOIN active_users au2 ON cn.updated_by_id = au2.staff_id
      LEFT JOIN staff        s1  ON cn.created_by_id = s1.staff_id
      LEFT JOIN staff        s2  ON cn.updated_by_id = s2.staff_id
      LEFT JOIN cases        cs  ON CAST(cs.case_id AS CHAR) = CAST(cn.case_id AS CHAR)
      WHERE CAST(cn.case_id AS CHAR) IN (${placeholders})
      ORDER BY cn.date DESC, cn.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...caseIds, limit, offset]
    );

    const [[{ "FOUND_ROWS()": totalNotes }]] = await db
      .promise()
      .query("SELECT FOUND_ROWS()");

    const formatDate = (date) =>
      new Date(date).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    const caseNotes = rows.map((n) => ({
      ...n,
      date: formatDate(n.date),
      createdAt: formatDate(n.createdAt),
      updatedAt: formatDate(n.updatedAt),
    }));

    res.json({ caseNotes, totalNotes, page, limit });
  } catch (err) {
    console.error("Error fetching company notes:", err);
    res.status(500).send("Error fetching company notes.");
  }
});

// GET /companies/:id/documents - Paginated documents across linked cases
router.get("/companies/:id/documents", async (req, res) => {
  const companyId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const caseIdsFromQuery = String(req.query.case_ids || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    let caseIds = caseIdsFromQuery;
    if (!caseIds.length) {
      const [linkedCases] = await db
        .promise()
        .query("SELECT case_id FROM company_case WHERE company_id = ?", [companyId]);
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.json({ documents: [], totalDocuments: 0, page, limit });
    }

    const placeholders = caseIds.map(() => "?").join(",");
    const [rows] = await db.promise().query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        d.id,
        d.case_id,
        d.filename AS fileName,
        d.path,
        d.uid AS uploader_uid,
        d.uid_name AS uploader_name,
        d.created_at AS createdAt,
        d.updated_at AS updatedAt,
        c.name AS case_name
      FROM documents d
      LEFT JOIN cases c ON CAST(c.case_id AS CHAR) = CAST(d.case_id AS CHAR)
      WHERE CAST(d.case_id AS CHAR) IN (${placeholders})
      ORDER BY d.updated_at DESC, d.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...caseIds, limit, offset]
    );

    const [[{ "FOUND_ROWS()": totalDocuments }]] = await db
      .promise()
      .query("SELECT FOUND_ROWS()");

    res.json({ documents: rows || [], totalDocuments, page, limit });
  } catch (err) {
    console.error("Error fetching company documents:", err);
    res.status(500).send("Error fetching company documents.");
  }
});

// GET /companies/:id/tasks - Paginated tasks across linked cases
router.get("/companies/:id/tasks", async (req, res) => {
  const companyId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const caseIdsFromQuery = String(req.query.case_ids || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    let caseIds = caseIdsFromQuery;
    if (!caseIds.length) {
      const [linkedCases] = await db
        .promise()
        .query("SELECT case_id FROM company_case WHERE company_id = ?", [companyId]);
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.json({ tasks: [], totalTasks: 0, page, limit });
    }

    const placeholders = caseIds.map(() => "?").join(",");
    const [rows] = await db.promise().query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        t.*,
        c.name AS case_name
      FROM task_record t
      LEFT JOIN cases c ON CAST(c.case_id AS CHAR) = CAST(t.case_id AS CHAR)
      WHERE CAST(t.case_id AS CHAR) IN (${placeholders})
      ORDER BY t.due_date ASC, t.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...caseIds, limit, offset]
    );

    const [[{ "FOUND_ROWS()": totalTasks }]] = await db
      .promise()
      .query("SELECT FOUND_ROWS()");

    res.json({ tasks: rows || [], totalTasks, page, limit });
  } catch (err) {
    console.error("Error fetching company tasks:", err);
    res.status(500).send("Error fetching company tasks.");
  }
});

// GET /companies/:id/time_entries - Paginated time entries across linked cases
router.get("/companies/:id/time_entries", async (req, res) => {
  const companyId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const caseIdsFromQuery = String(req.query.case_ids || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    let caseIds = caseIdsFromQuery;
    if (!caseIds.length) {
      const [linkedCases] = await db
        .promise()
        .query("SELECT case_id FROM company_case WHERE company_id = ?", [companyId]);
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.json({ data: [], totalTimeEntries: 0, page, limit });
    }

    const placeholders = caseIds.map(() => "?").join(",");

    const [rows] = await db.promise().query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        te.time_entry_id,
        te.description,
        te.entry_date,
        te.billable,
        te.case_id,
        te.staff_id,
        te.activity_name,
        te.created_at,
        te.updated_at,
        te.rate,
        te.flat_fee,
        te.hours,
        te.updated_by_uid,
        te.uid,
        c.name AS case_name,
        CONCAT(au.first_name, ' ', au.last_name) AS active_user_staff_name,
        CONCAT(s.first_name, ' ', s.last_name) AS staff_table_staff_name
      FROM time_entries te
      LEFT JOIN cases c ON CAST(c.case_id AS CHAR) = CAST(te.case_id AS CHAR)
      LEFT JOIN active_users au ON te.staff_id = au.staff_id
      LEFT JOIN staff s ON te.staff_id = s.staff_id
      WHERE CAST(te.case_id AS CHAR) IN (${placeholders})
      ORDER BY te.entry_date DESC, te.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...caseIds, limit, offset]
    );

    const [[{ "FOUND_ROWS()": totalTimeEntries }]] = await db
      .promise()
      .query("SELECT FOUND_ROWS()");

    res.json({ data: rows || [], totalTimeEntries, page, limit });
  } catch (err) {
    console.error("Error fetching company time entries:", err);
    res.status(500).send("Error fetching company time entries.");
  }
});

/** Rows per INSERT inside one transaction (avoids huge packets on very large companies). */
const BULK_TIME_ENTRY_CHUNK = 500;

// POST /companies/:id/time_entries/bulk — one request: same time entry on all (or listed) linked cases
router.post("/companies/:companyId/time_entries/bulk", async (req, res) => {
  const companyId = req.params.companyId;
  const {
    description,
    entry_date,
    billable,
    staff_id,
    activity_name,
    rate,
    flat_fee,
    hours,
    uid,
    case_ids: caseIdsBody,
  } = req.body;

  // Match POST /time_entries required-field rules (no stricter checks here).
  if (!description || !entry_date || !activity_name || !rate || !hours) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  let caseIds = Array.isArray(caseIdsBody)
    ? caseIdsBody.map((v) => String(v).trim()).filter(Boolean)
    : [];

  try {
    if (!caseIds.length) {
      const [linkedCases] = await db
        .promise()
        .query("SELECT case_id FROM company_case WHERE company_id = ?", [companyId]);
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.status(400).json({ error: "No cases linked to this company." });
    }

    const uniqueCaseIds = [...new Set(caseIds)];
    const inPlaceholders = uniqueCaseIds.map(() => "?").join(",");
    const [validLinks] = await db.promise().query(
      `SELECT case_id FROM company_case WHERE company_id = ? AND case_id IN (${inPlaceholders})`,
      [companyId, ...uniqueCaseIds]
    );
    const allowed = new Set(validLinks.map((r) => String(r.case_id)));
    if (allowed.size !== uniqueCaseIds.length) {
      return res.status(400).json({ error: "One or more cases are not linked to this company." });
    }

    const companyTimeBatchId = crypto.randomUUID();
    const connection = await db.promise().getConnection();

    const insertRowSql = `(?, ?, ?, ?, ?, ?, CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), ?, ?, ?, ?, ?)`;

    try {
      await connection.beginTransaction();

      for (let i = 0; i < uniqueCaseIds.length; i += BULK_TIME_ENTRY_CHUNK) {
        const chunk = uniqueCaseIds.slice(i, i + BULK_TIME_ENTRY_CHUNK);
        const placeholders = chunk.map(() => insertRowSql).join(", ");
        const flatValues = [];
        for (const cid of chunk) {
          flatValues.push(
            description,
            entry_date,
            billable,
            cid,
            staff_id,
            activity_name,
            rate,
            flat_fee,
            hours,
            uid,
            companyTimeBatchId
          );
        }
        await connection.query(
          `INSERT INTO time_entries (description, entry_date, billable, case_id, staff_id, activity_name,
            created_at, updated_at, rate, flat_fee, hours, uid, company_time_batch_id) VALUES ${placeholders}`,
          flatValues
        );
      }

      const [createdRows] = await connection.query(
        `SELECT time_entry_id, case_id FROM time_entries WHERE company_time_batch_id = ? ORDER BY time_entry_id`,
        [companyTimeBatchId]
      );

      for (let j = 0; j < createdRows.length; j += BULK_TIME_ENTRY_CHUNK) {
        const logSlice = createdRows.slice(j, j + BULK_TIME_ENTRY_CHUNK);
        const logPlaceholders = logSlice
          .map(() => "(?, 'create', ?, ?, CONVERT_TZ(NOW(), 'UTC', 'America/New_York'))")
          .join(", ");
        const logFlat = [];
        for (const r of logSlice) {
          logFlat.push(r.time_entry_id, r.case_id, uid);
        }
        await connection.query(
          `INSERT INTO time_entry_logs (time_entry_id, action, case_id, uid, timestamp) VALUES ${logPlaceholders}`,
          logFlat
        );
      }

      await connection.commit();

      res.status(201).json({
        message: "Time entries created for all linked cases.",
        created: createdRows.length,
        company_time_batch_id: companyTimeBatchId,
        time_entry_ids: createdRows.map((r) => r.time_entry_id),
      });
    } catch (innerErr) {
      await connection.rollback();
      throw innerErr;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error bulk-creating company time entries:", err);
    res.status(500).json({ error: "Error creating time entries.", details: err.message });
  }
});


// GET /companies/:id/events - Paginated events across linked cases
router.get("/companies/:id/events", async (req, res) => {
  const companyId = req.params.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const start = req.query.start;
  const end = req.query.end;
  const caseIdsFromQuery = String(req.query.case_ids || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    let caseIds = caseIdsFromQuery;
    if (!caseIds.length) {
      const [linkedCases] = await db
        .promise()
        .query("SELECT case_id FROM company_case WHERE company_id = ?", [companyId]);
      caseIds = linkedCases.map((r) => String(r.case_id)).filter(Boolean);
    }

    if (!caseIds.length) {
      return res.json({ events: [], totalEvents: 0, page, limit });
    }

    const placeholders = caseIds.map(() => "?").join(",");
    const dateCondition = start && end ? "AND e.start_event BETWEEN ? AND ?" : "";
    const dateParams = start && end ? [start, end] : [];

    const [rows] = await db.promise().query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        e.id,
        e.event_name,
        e.event_type,
        e.event_description,
        e.start_event,
        e.end_event,
        e.staff,
        e.location,
        c.name AS case_name,
        c.case_id,
        (
          SELECT GROUP_CONCAT(CONCAT(s.first_name, ' ', s.last_name) SEPARATOR ', ')
          FROM staff s
          WHERE FIND_IN_SET(s.staff_id, e.staff)
        ) AS staff_names
      FROM case_events e
      LEFT JOIN cases c ON CAST(c.case_id AS CHAR) = CAST(e.case_id AS CHAR)
      WHERE CAST(e.case_id AS CHAR) IN (${placeholders})
      ${dateCondition}
      ORDER BY e.start_event ASC
      LIMIT ? OFFSET ?
      `,
      [...caseIds, ...dateParams, limit, offset]
    );

    const [[{ "FOUND_ROWS()": totalEvents }]] = await db
      .promise()
      .query("SELECT FOUND_ROWS()");

    const formattedEvents = (rows || []).map((event) => ({
      id: event.id,
      title: event.event_name || "Unnamed Event",
      description: event.event_description || "No description available",
      start: event.start_event,
      end: event.end_event,
      case_name: event.case_name || "No associated case",
      case_id: event.case_id,
      event_type: event.event_type,
      staff: event.staff,
      staff_name: event.staff_names || "No staff assigned",
      location: event.location || "No location",
    }));

    res.json({ events: formattedEvents, totalEvents, page, limit });
  } catch (err) {
    console.error("Error fetching company events:", err);
    res.status(500).send("Error fetching company events.");
  }
});
// 📘 GET /companies/:id
router.get("/companies/:id", (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM company WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send("Error fetching company.");
    if (!result.length) return res.status(404).send("Company not found.");
    res.json(result[0]);
  });
});
 
// 🟢 POST /companies – Create
router.post("/companies", (req, res) => {
  const allowedFields = [
    "id", "name", "email", "website", "notes", "address1", "address2",
    "city", "state", "zip_code", "country", "main_phone_number",
    "fax_phone_number", "created_at", "updated_at", "archived"
  ];

  const data = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      data[field] = req.body[field];
    }
  }

  if (!data.name) {
    return res.status(400).send("Company name is required.");
  }

  const now = new Date();
  if (!data.created_at) data.created_at = now;
  if (!data.updated_at) data.updated_at = now;

  db.query("INSERT INTO company SET ?", [data], (err, result) => {
    if (err) {
      console.error("SQL Error:", err);
      return res.status(500).json({ error: "Error creating company.", details: err.message });
    }
    res.status(201).json({ message: "Company created.", id: data.id || result.insertId });
  });
});
 
// 🟡 PUT /companies/:id – Update
router.put("/companies/:id", (req, res) => {
  const id = req.params.id;
 
  // 🧼 Remove non-column fields from the body
  const {
    cases,
    clients,
    ...data
  } = req.body;
 
  data.updated_at = new Date();

  db.query("UPDATE company SET ? WHERE id = ?", [data, id], (err, result) => {
    if (err) {
      console.error("SQL Error:", err);
      return res.status(500).send("Error updating company.");
    }
 
    if (!result.affectedRows) {
      return res.status(404).send("Company not found.");
    }
 
    res.send("Company updated.");
  });
});
 
 
 
router.delete("/companies/:id", (req, res) => {
  const id = req.params.id;
  db.query("DELETE FROM company WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send("Error deleting company.");
    if (!result.affectedRows) return res.status(404).send("Company not found.");
    res.send("Company deleted.");
  });
});
 
// POST /companies/:id/cases – Link a company to a case
router.post("/companies/:id/cases", (req, res) => {
  const companyId = req.params.id;
  const { case_id } = req.body;

  if (!case_id) {
    return res.status(400).send("case_id is required.");
  }

  const sql = "INSERT IGNORE INTO company_case (company_id, case_id) VALUES (?, ?)";
  db.query(sql, [companyId, case_id], (err) => {
    if (err) return res.status(500).send("Error linking company to case.");
    res.status(201).json({ message: "Company linked to case." });
  });
});

// POST /companies/:id/clients – Link a company to a client
router.post("/companies/:id/clients", (req, res) => {
  const companyId = req.params.id;
  const { client_id } = req.body;

  if (!client_id) {
    return res.status(400).send("client_id is required.");
  }

  const sql =
    "INSERT IGNORE INTO company_client (company_id, client_id) VALUES (?, ?)";
  db.query(sql, [companyId, client_id], (err) => {
    if (err) return res.status(500).send("Error linking company to client.");
    res.status(201).json({ message: "Company linked to client." });
  });
});
// DELETE /companies/:id/cases/:caseId – Unlink a company from a case
router.delete("/companies/:id/cases/:caseId", (req, res) => {
  const { id, caseId } = req.params;

  const sql = "DELETE FROM company_case WHERE company_id = ? AND case_id = ?";
  db.query(sql, [id, caseId], (err, result) => {
    if (err) return res.status(500).send("Error unlinking company from case.");
    if (!result.affectedRows) return res.status(404).send("Link not found.");
    res.send("Company unlinked from case.");
  });
});
// DELETE /companies/:id/clients/:clientId – Unlink a company from a client
router.delete("/companies/:id/clients/:clientId", (req, res) => {
  const { id, clientId } = req.params;

  const sql = "DELETE FROM company_client WHERE company_id = ? AND client_id = ?";
  db.query(sql, [id, clientId], (err, result) => {
    if (err) return res.status(500).send("Error unlinking company from client.");
    if (!result.affectedRows) return res.status(404).send("Link not found.");
    res.send("Company unlinked from client.");
  });
});

// GET /companies/case/:caseId – Get all companies linked to a specific case
router.get("/companies/case/:caseId", (req, res) => {
  const caseId = req.params.caseId;

  const sql = `
    SELECT c.* FROM company c
    JOIN company_case cc ON c.id = cc.company_id
    WHERE cc.case_id = ?
  `;

  db.query(sql, [caseId], (err, results) => {
    if (err) return res.status(500).send("Error fetching companies for case.");
    res.json(results);
  });
});

module.exports = router;
 
 