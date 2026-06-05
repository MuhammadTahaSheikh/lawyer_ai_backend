// routes/cases.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { spawn } = require("child_process");
const twilio = require("twilio");

// Twilio configuration (env only; no hardcoded fallbacks)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = (accountSid && authToken) ? twilio(accountSid, authToken) : null;
if (!accountSid || !authToken) {
  console.warn("[cases.js] Twilio credentials not set; Twilio features disabled.");
}

// Python interpreter path from your venv folder
const pythonPath = path.join(__dirname, "..", "venv", "bin", "python");

// Configure Multer for image upload (for case media)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const caseId = req.params.caseId;
    const dir = path.join(__dirname, "..", "case-media", caseId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, "logo" + ext);
  },
});
const imageUpload = multer({ storage });

// POST /cases/:caseId/media – upload media (e.g. staff profile image)
router.post("/cases/:caseId/media", imageUpload.single("media"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No media file uploaded." });
  }

  const caseId = req.params.caseId;
  const { name, description, assigned_date, uid } = req.body;
  const fileName = req.file.filename;
  const relativePath = path.posix.join("case-media", String(caseId), fileName);
  const assignedDate = assigned_date ? new Date(assigned_date) : new Date();

  const query = `
    INSERT INTO media (name, filename, path, description, assigned_date, case_id, uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  try {
    await db.promise().query(query, [
      name || fileName,
      fileName,
      relativePath,
      description || null,
      assignedDate,
      parseInt(caseId, 10) || caseId,
      uid || null,
    ]);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imageUrl = `${baseUrl}/${relativePath}`;
    res.status(200).json({ imageUrl, url: imageUrl, path: relativePath });
  } catch (err) {
    console.error("Error uploading media:", err);
    res.status(500).json({ message: "Error saving media.", error: err.message });
  }
});

// Helper: Get columns from "cases" table
function getExistingColumns() {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT column_name AS "Field" FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cases'
       ORDER BY ordinal_position`,
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map((row) => row.Field || row.field));
      }
    );
  });
}
function formatActivities(rows) {
  return rows.map(activity => {
    if (activity.action === 'update' && activity.field_name) {
      return {
        ...activity,
        message: `${activity.field_name} changed from "${activity.old_value}" to "${activity.new_value}" by ${activity.first_name} ${activity.last_name} at ${new Date(activity.timestamp).toLocaleString()}`
      };
    } else if (activity.action === 'create') {
      return {
        ...activity,
        message: `Case created by ${activity.first_name} ${activity.last_name} at ${new Date(activity.timestamp).toLocaleString()}`
      };
    }
    return activity;
  });
}

/* ---------- Shared helpers for GET/POST filter handling ---------- */
function getFilterSource(req) {
  return req.method === 'GET' ? req.query : (req.body || {});
}
/** Case search: keep legacy behavior and add token matching for multi-word queries.
 *  - One word: identical to original (single LIKE group on name / case_number / [claim_number]).
 *  - Several words: (legacy contiguous full-string LIKE) OR (each token must match, ANDed across
 *    the same fields), so phrase matches still work and names like "Anderson, Lisa" also match. */
function pushCaseSearchConditions(search, conditions, values, { includeClaimNumber = true } = {}) {
  const s = String(search || "").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return;

  if (tokens.length === 1) {
    if (includeClaimNumber) {
      conditions.push("(name LIKE ? OR case_number LIKE ? OR claim_number LIKE ?)");
      values.push(`%${tokens[0]}%`, `%${tokens[0]}%`, `%${tokens[0]}%`);
    } else {
      conditions.push("(name LIKE ? OR case_number LIKE ?)");
      values.push(`%${tokens[0]}%`, `%${tokens[0]}%`);
    }
    return;
  }

  const legacyClause = includeClaimNumber
    ? "(name LIKE ? OR case_number LIKE ? OR claim_number LIKE ?)"
    : "(name LIKE ? OR case_number LIKE ?)";
  const tokenClauses = [];
  tokens.forEach(() => {
    if (includeClaimNumber) {
      tokenClauses.push("(name LIKE ? OR case_number LIKE ? OR claim_number LIKE ?)");
    } else {
      tokenClauses.push("(name LIKE ? OR case_number LIKE ?)");
    }
  });
  const tokenizedClause = `(${tokenClauses.join(" AND ")})`;
  conditions.push(`(${legacyClause} OR ${tokenizedClause})`);

  if (includeClaimNumber) {
    values.push(`%${s}%`, `%${s}%`, `%${s}%`);
  } else {
    values.push(`%${s}%`, `%${s}%`);
  }
  for (const token of tokens) {
    if (includeClaimNumber) {
      values.push(`%${token}%`, `%${token}%`, `%${token}%`);
    } else {
      values.push(`%${token}%`, `%${token}%`);
    }
  }
}

function normalizeCustomFieldsForSelection(srcCustomFields) {
  // Returns { includeFields: string[], queries: array }
  if (!srcCustomFields) return { includeFields: [], queries: [] };

  // Legacy array form: [{ field_name, operator, value }]
  if (Array.isArray(srcCustomFields)) {
    const includeFields = srcCustomFields
      .map(f => f.field_name)
      .filter(Boolean);
    return { includeFields, queries: srcCustomFields };
  }

  // New compact form: { include_fields: [], queries: [] }
  const includeFields = Array.isArray(srcCustomFields.include_fields) ? srcCustomFields.include_fields : [];
  const queries = Array.isArray(srcCustomFields.queries) ? srcCustomFields.queries : [];
  return { includeFields, queries };
}

function applyCustomQueriesToWhere(queriesArr, conditions, values) {
  (queriesArr || []).forEach(({ field, field_name, operator, value }) => {
    const name = field_name || field; // accept either
    if (!name) return;
    const escapedField = `\`${String(name).replace(/`/g, '``')}\``;

    if (operator && value !== undefined && value !== null) {
      if (operator === "equals") {
        conditions.push(`${escapedField} = ?`);
        values.push(value);
      } else if (operator === "not_equals") {
        conditions.push(`(${escapedField} IS NULL OR ${escapedField} != ?)`);
        values.push(value);
      } else if (operator === "contains") {
        conditions.push(`${escapedField} LIKE ?`);
        values.push(`%${value}%`);
      } else if (operator === "on") {
        conditions.push(`DATE(STR_TO_DATE(${escapedField}, '%Y-%m-%d')) = ?`);
        values.push(value);
      } else if (operator === "before") {
        conditions.push(`DATE(STR_TO_DATE(${escapedField}, '%Y-%m-%d')) < ?`);
        values.push(value);
      } else if (operator === "after") {
        conditions.push(`DATE(STR_TO_DATE(${escapedField}, '%Y-%m-%d')) > ?`);
        values.push(value);
      } else if (operator === "between" && Array.isArray(value) && value.length === 2) {
        conditions.push(`DATE(STR_TO_DATE(${escapedField}, '%Y-%m-%d')) BETWEEN ? AND ?`);
        values.push(value[0], value[1]);
      }
    }
  });
}

function mergeSelectedColumns(baseCols, includeFields) {
  const escaped = (includeFields || []).map(name => `\`${String(name).replace(/`/g, '``')}\``);
  return [...new Set([ ...baseCols, ...escaped ])];
}

function hasMeaningfulValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function enrichCasesWithNextEventAndTask(rows, callback) {
  const list = Array.isArray(rows) ? rows : [];
  const caseIds = list.map((r) => r.case_id).filter((id) => id != null);

  if (caseIds.length === 0) {
    return callback(list);
  }

  const placeholders = caseIds.map(() => "?").join(",");
  const nextEventQuery = `
    SELECT e.case_id, e.event_name
    FROM case_events e
    INNER JOIN (
      SELECT case_id, MIN(start_event) AS next_start
      FROM case_events
      WHERE case_id IN (${placeholders}) AND start_event >= NOW()
      GROUP BY case_id
    ) ne ON ne.case_id = e.case_id AND ne.next_start = e.start_event
  `;
  const nextTaskQuery = `
    SELECT t.case_id, t.task_name
    FROM task_record t
    INNER JOIN (
      SELECT case_id, MIN(due_date) AS next_due
      FROM task_record
      WHERE case_id IN (${placeholders}) AND completed = 0 AND due_date >= CURDATE()
      GROUP BY case_id
    ) nt ON nt.case_id = t.case_id AND nt.next_due = t.due_date
  `;

  db.query(nextEventQuery, caseIds, (eventErr, eventRows) => {
    if (eventErr) {
      console.error("Error fetching next events:", eventErr);
    }
    const nextEventByCaseId = (eventRows || []).reduce((acc, row) => {
      if (!acc[row.case_id] && hasMeaningfulValue(row.event_name)) {
        acc[row.case_id] = row.event_name;
      }
      return acc;
    }, {});

    db.query(nextTaskQuery, caseIds, (taskErr, taskRows) => {
      if (taskErr) {
        console.error("Error fetching next tasks:", taskErr);
      }
      const nextTaskByCaseId = (taskRows || []).reduce((acc, row) => {
        if (!acc[row.case_id] && hasMeaningfulValue(row.task_name)) {
          acc[row.case_id] = row.task_name;
        }
        return acc;
      }, {});

      const enriched = list.map((c) => ({
        ...c,
        next_event: hasMeaningfulValue(c.next_event) ? c.next_event : (nextEventByCaseId[c.case_id] || ""),
        next_task: hasMeaningfulValue(c.next_task) ? c.next_task : (nextTaskByCaseId[c.case_id] || ""),
      }));

      callback(enriched);
    });
  });
}
/* ---------------- GET /cases (existing) ---------------- */
router.get("/cases", (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limitParam = req.query.limit;
  let limit = 100;
  let noLimit = false;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      if (parsed === 0) {
        noLimit = true;
      } else {
        limit = parsed;
      }
    }
  }
  const offset = noLimit ? 0 : (page - 1) * limit;
  const caseStage = req.query.case_stage || "";
  const search = req.query.search || "";
  const practiceArea = req.query.practice_area || "";
  const startDate = req.query.start_date || "";
  const endDate = req.query.end_date || "";
  const sort = req.query.sort || "STR_TO_DATE(opened_date, '%m/%d/%y') DESC";
  const uid = req.query.uid || "";
  const reportUid = req.query.report_uid || "";
  const closeDateStatus = req.query.close_date_status || "";
  const assignedAttorney = req.query.assigned_attorney || "";

  let conditions = [];
  let values = [];

  if (caseStage) {
    conditions.push("case_stage = ?");
    values.push(caseStage);
  }

  if (search) {
    // conditions.push("(name LIKE ? OR case_number LIKE ? OR claim_number LIKE ?)");
    // values.push(`%${search}%`, `%${search}%`, `%${search}%`);
        pushCaseSearchConditions(search, conditions, values, { includeClaimNumber: true });

  }

  if (practiceArea) {
    conditions.push("practice_area = ?");
    values.push(practiceArea);
  }

  if (assignedAttorney) {
    conditions.push("assigned_attorney = ?");
    values.push(assignedAttorney);
  }

  if (req.query.custom_fields) {
    try {
      // accept legacy GET array
      const customFields = JSON.parse(req.query.custom_fields);
      applyCustomQueriesToWhere(customFields, conditions, values);
    } catch (err) {
      console.error("Failed to parse custom field filters:", err);
    }
  }

  if (startDate && endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) BETWEEN ? AND ?");
    values.push(startDate, endDate);
  } else if (startDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) >= ?");
    values.push(startDate);
  } else if (endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) <= ?");
    values.push(endDate);
  }

  if (closeDateStatus === "open") {
    conditions.push("(COALESCE(closed_date, '') = '')");
  } else if (closeDateStatus === "closed") {
    conditions.push("(COALESCE(closed_date, '') != '')");
  }

  let selectedColumns = [
    'case_id',
    'name',
    'case_number',
    'practice_area',
    'assigned_attorney',
    'case_stage',
    'opened_date',
    'date_of_damage',
    'closed_date',
    'insured_property',
    'policy_number',
    'date_of_loss',
    'pa_estimate',
    '`undisputed/prior_payment`',
    'claim_number',
    'clients_phone_number',
    'clients_email',
    'coverage_determination',
    'type_of_loss_specify',
    'type_of_loss_automated'
  ];

  if (req.query.custom_fields) {
    try {
      const customFields = JSON.parse(req.query.custom_fields);
      const fieldNames = customFields.map(f => f.field_name).filter(Boolean);
      selectedColumns = mergeSelectedColumns(selectedColumns, fieldNames);
    } catch (err) {
      console.error("Failed to parse custom fields for selection:", err);
    }
  }

  if (uid && !reportUid && req.query.show_all !== 'true') {
    const permissionQuery = `
      SELECT
        (SELECT GROUP_CONCAT(DISTINCT case_id) FROM user_case_assignments WHERE uid = ?) AS case_ids,
        (SELECT GROUP_CONCAT(DISTINCT practice_area) FROM user_practice_areas WHERE uid = ?) AS practice_areas
    `;

    db.query(permissionQuery, [uid, uid], (err, result) => {
      if (err) {
        console.error("Error fetching user permissions:", err);
        return res.status(500).send("Error checking user permissions.");
      }

      const caseIdList = result[0]?.case_ids?.split(',').map(Number).filter(Boolean) || [];
      const practiceAreaList = result[0]?.practice_areas?.split(',').map(String).filter(Boolean) || [];

      if (caseIdList.length === 0 && practiceAreaList.length === 0) {
        finalizeCaseQuery();
        return;
      }

      const permissionConditions = [];

      permissionConditions.push("(uid = ? OR assigned_attorney_uid = ?)");
      values.push(uid, uid);

      if (caseIdList.length) {
        permissionConditions.push(`case_id IN (${caseIdList.map(() => '?').join(',')})`);
        values.push(...caseIdList);
      }

      if (practiceAreaList.length) {
        permissionConditions.push(`practice_area IN (${practiceAreaList.map(() => '?').join(',')})`);
        values.push(...practiceAreaList);
      }

      if (permissionConditions.length > 0) {
        conditions.push(`(${permissionConditions.join(' OR ')})`);
      }

      finalizeCaseQuery();
    });

    return;
  }

  if (reportUid) {
    conditions.push("(uid = ? OR assigned_attorney_uid = ?)");
    values.push(reportUid, reportUid);
  }

  finalizeCaseQuery();

  function finalizeCaseQuery() {
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalCasesQuery = `SELECT COUNT(*) AS totalCases FROM cases ${whereClause}`;
    const limitClause = noLimit ? '' : 'LIMIT ? OFFSET ?';
    const paginatedCasesQuery = `
      SELECT ${selectedColumns.join(", ")}
      FROM cases
      ${whereClause}
      ORDER BY ${sort}
      ${limitClause}
    `;
    const paginatedValues = noLimit ? values : [...values, limit, offset];

    db.query(totalCasesQuery, values, (err, totalResults) => {
      if (err) {
        console.error("Error fetching total cases:", err);
        return res.status(500).send("Error fetching total cases.");
      }

      const totalCases = totalResults[0]?.totalCases || 0;
      db.query(paginatedCasesQuery, paginatedValues, (err, paginatedResults) => {
        if (err) {
          console.error("Error fetching cases:", err);
          return res.status(500).send("Error fetching cases.");
        }

        res.json({
          totalCases,
          cases: paginatedResults,
        });
      });
    });
  }
});

/* ---------------- POST-compatible list handler and route ---------------- */
function handleCasesListPost(req, res) {
  const src = getFilterSource(req);

  const page = parseInt(src.page, 10) || 1;
  const limitParam = src.limit;
  let limit = 100;
  let noLimit = false;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      if (parsed === 0) noLimit = true;
      else limit = parsed;
    }
  }
  const offset = noLimit ? 0 : (page - 1) * limit;

  // const caseStage = src.case_stage || "";
   const caseStageRaw = src.case_stage;
  const caseStages = Array.isArray(caseStageRaw) ? caseStageRaw.filter(Boolean) : (caseStageRaw ? [caseStageRaw] : []);
  const search = src.search || "";
  // const practiceArea = src.practice_area || "";

  const practiceAreaRaw = src.practice_area;
  const practiceAreas = Array.isArray(practiceAreaRaw) ? practiceAreaRaw.filter(Boolean) : (practiceAreaRaw ? [practiceAreaRaw] : []);
  const startDate = src.start_date || "";
  const endDate = src.end_date || "";
  const sort = src.sort || "STR_TO_DATE(opened_date, '%m/%d/%y') DESC";
  const uid = src.uid || "";
  const reportUid = src.report_uid || "";
  const closeDateStatus = src.close_date_status || "";
  const assignedAttorney = src.assigned_attorney || "";

  let conditions = [];
  let values = [];

  // if (caseStage) { conditions.push("case_stage = ?"); values.push(caseStage); }
if (caseStages.length === 1) {
    conditions.push("case_stage = ?");
    values.push(caseStages[0]);
  } else if (caseStages.length > 1) {
    conditions.push(`case_stage IN (${caseStages.map(() => '?').join(',')})`);
    values.push(...caseStages);
  }
  if (search) {
    // conditions.push("(name LIKE ? OR case_number LIKE ? OR claim_number LIKE ?)");
    // values.push(`%${search}%`, `%${search}%`, `%${search}%`);
        pushCaseSearchConditions(search, conditions, values, { includeClaimNumber: true });

  }

  // if (practiceArea) { conditions.push("practice_area = ?"); values.push(practiceArea); }
if (practiceAreas.length === 1) {
    conditions.push("practice_area = ?");
    values.push(practiceAreas[0]);
  } else if (practiceAreas.length > 1) {
    conditions.push(`practice_area IN (${practiceAreas.map(() => '?').join(',')})`);
    values.push(...practiceAreas);
  }
  if (assignedAttorney) { conditions.push("assigned_attorney = ?"); values.push(assignedAttorney); }

  const { includeFields, queries } = normalizeCustomFieldsForSelection(src.custom_fields);
  applyCustomQueriesToWhere(queries, conditions, values);

  if (startDate && endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) BETWEEN ? AND ?");
    values.push(startDate, endDate);
  } else if (startDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) >= ?");
    values.push(startDate);
  } else if (endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) <= ?");
    values.push(endDate);
  }

  if (closeDateStatus === "open") {
    conditions.push("(COALESCE(closed_date, '') = '')");
  } else if (closeDateStatus === "closed") {
    conditions.push("(COALESCE(closed_date, '') != '')");
  }

  let selectedColumns = [
    'case_id',
    'name',
    'case_number',
    'practice_area',
    'assigned_attorney',
    'case_stage',
    'opened_date',
    'date_of_damage',
    'closed_date',
    'insured_property',
    'policy_number',
    'date_of_loss',
    'pa_estimate',
    '`undisputed/prior_payment`',
    'claim_number',
    'clients_phone_number',
    'clients_email',
    'coverage_determination',
    'type_of_loss_specify',
    'type_of_loss_automated'
  ];
  selectedColumns = mergeSelectedColumns(selectedColumns, includeFields);

  if (uid && !reportUid && src.show_all !== 'true') {
    const permissionQuery = `
      SELECT
        (SELECT GROUP_CONCAT(DISTINCT case_id) FROM user_case_assignments WHERE uid = ?) AS case_ids,
        (SELECT GROUP_CONCAT(DISTINCT practice_area) FROM user_practice_areas WHERE uid = ?) AS practice_areas
    `;

    return db.query(permissionQuery, [uid, uid], (err, result) => {
      if (err) {
        console.error("Error fetching user permissions:", err);
        return res.status(500).send("Error checking user permissions.");
      }

      const caseIdList = result[0]?.case_ids?.split(',').map(Number).filter(Boolean) || [];
      const practiceAreaList = result[0]?.practice_areas?.split(',').map(String).filter(Boolean) || [];

      const permissionConditions = [];
      permissionConditions.push("(uid = ? OR assigned_attorney_uid = ?)");
      values.push(uid, uid);

      if (caseIdList.length) {
        permissionConditions.push(`case_id IN (${caseIdList.map(() => '?').join(',')})`);
        values.push(...caseIdList);
      }

      if (practiceAreaList.length) {
        permissionConditions.push(`practice_area IN (${practiceAreaList.map(() => '?').join(',')})`);
        values.push(...practiceAreaList);
      }

      if (permissionConditions.length > 0) {
        conditions.push(`(${permissionConditions.join(' OR ')})`);
      }

      finalize();
    });
  }

  if (reportUid) {
    conditions.push("(uid = ? OR assigned_attorney_uid = ?)");
    values.push(reportUid, reportUid);
  }

  return finalize();

  function finalize() {
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalCasesQuery = `SELECT COUNT(*) AS totalCases FROM cases ${whereClause}`;
    const limitClause = noLimit ? '' : 'LIMIT ? OFFSET ?';
    const paginatedCasesQuery = `
      SELECT ${selectedColumns.join(", ")}
      FROM cases
      ${whereClause}
      ORDER BY ${sort}
      ${limitClause}
    `;
    const paginatedValues = noLimit ? values : [...values, limit, offset];

    db.query(totalCasesQuery, values, (err, totalResults) => {
      if (err) {
        console.error("Error fetching total cases:", err);
        return res.status(500).send("Error fetching total cases.");
      }

      const totalCases = totalResults[0]?.totalCases || 0;
      db.query(paginatedCasesQuery, paginatedValues, (err, paginatedResults) => {
        if (err) {
          console.error("Error fetching cases:", err);
          return res.status(500).send("Error fetching cases.");
        }

        // res.json({ totalCases, cases: paginatedResults });
        // Add billable/non_billable amounts via one aggregation query (avoids slow per-row subqueries).
        // These two fields are additive; other consumers of /cases/search ignore them.
        // Add billable/non_billable amounts via one aggregation query (avoids slow per-row subqueries).
        // These two fields are additive; other consumers of /cases/search ignore them.
        const caseIds = (paginatedResults || []).map((r) => r.case_id).filter((id) => id != null);
        if (caseIds.length === 0) {
          const casesWithAmounts = (paginatedResults || []).map((c) => ({
            ...c,
            billable_amount: 0,
            non_billable_amount: 0,
            billable_expenses: 0,
            non_billable_expenses: 0,
          }));
          // return res.json({ totalCases, cases: casesWithAmounts });
           return enrichCasesWithNextEventAndTask(casesWithAmounts, (enrichedCases) => {
            res.json({ totalCases, cases: enrichedCases });
          });
        }

        const placeholders = caseIds.map(() => "?").join(",");
        const amountsQuery = `
          SELECT case_id,
            COALESCE(SUM(CASE WHEN billable = 1 THEN rate * hours ELSE 0 END), 0) AS billable_amount,
            COALESCE(SUM(CASE WHEN billable = 0 THEN rate * hours ELSE 0 END), 0) AS non_billable_amount
          FROM time_entries
          WHERE case_id IN (${placeholders})
          GROUP BY case_id
        `;
        const expensesQuery = `
          SELECT case_id,
            COALESCE(SUM(CASE WHEN billable = 1 THEN cost * units ELSE 0 END), 0) AS billable_expenses,
            COALESCE(SUM(CASE WHEN billable = 0 THEN cost * units ELSE 0 END), 0) AS non_billable_expenses
          FROM expenses
          WHERE case_id IN (${placeholders})
          GROUP BY case_id
        `;
        db.query(amountsQuery, caseIds, (errAmounts, amountsRows) => {
          if (errAmounts) {
            console.error("Error fetching billable amounts:", errAmounts);
            const casesWithAmounts = (paginatedResults || []).map((c) => ({
              ...c,
              billable_amount: 0,
              non_billable_amount: 0,
              billable_expenses: 0,
              non_billable_expenses: 0,
            }));
            // return res.json({ totalCases, cases: casesWithAmounts });
             return enrichCasesWithNextEventAndTask(casesWithAmounts, (enrichedCases) => {
              res.json({ totalCases, cases: enrichedCases });
            });
          }
          const amountByCaseId = (amountsRows || []).reduce((acc, row) => {
            acc[row.case_id] = {
              billable_amount: parseFloat(row.billable_amount) || 0,
              non_billable_amount: parseFloat(row.non_billable_amount) || 0,
            };
            return acc;
          }, {});
          db.query(expensesQuery, caseIds, (errExp, expensesRows) => {
            if (errExp) {
              console.error("Error fetching expense amounts:", errExp);
            }
            const expenseByCaseId = (expensesRows || []).reduce((acc, row) => {
              acc[row.case_id] = {
                billable_expenses: parseFloat(row.billable_expenses) || 0,
                non_billable_expenses: parseFloat(row.non_billable_expenses) || 0,
              };
              return acc;
            }, {});
            const casesWithAmounts = (paginatedResults || []).map((c) => ({
              ...c,
              billable_amount: amountByCaseId[c.case_id]?.billable_amount ?? 0,
              non_billable_amount: amountByCaseId[c.case_id]?.non_billable_amount ?? 0,
              billable_expenses: expenseByCaseId[c.case_id]?.billable_expenses ?? 0,
              non_billable_expenses: expenseByCaseId[c.case_id]?.non_billable_expenses ?? 0,
            }));
            // res.json({ totalCases, cases: casesWithAmounts });
            enrichCasesWithNextEventAndTask(casesWithAmounts, (enrichedCases) => {
              res.json({ totalCases, cases: enrichedCases });
            });
          });
        });
      });
    });
  }
}

// Register POST search endpoint (body-based filters)
router.post("/cases/search", (req, res) => handleCasesListPost(req, res));

/* ---------------- GET /cases/export (existing) ---------------- */
router.get("/cases/export", (req, res) => {
  const sort = req.query.sort || "STR_TO_DATE(opened_date, '%m/%d/%y') DESC";
  const caseStage = req.query.case_stage || "";
  const search = req.query.search || "";
  const practiceArea = req.query.practice_area || "";
  const startDate = req.query.start_date || "";
  const endDate = req.query.end_date || "";
  const uid = req.query.uid || "";
  const assignedAttorney = req.query.assigned_attorney || "";
  const closeDateStatus = req.query.close_date_status || "";
 
  let conditions = [];
  let values = [];
 
  if (caseStage) {
    conditions.push("case_stage = ?");
    values.push(caseStage);
  }
 
  if (search) {
    // conditions.push("(name LIKE ? OR case_number LIKE ?)");
    // values.push(`%${search}%`, `%${search}%`);
      pushCaseSearchConditions(search, conditions, values, { includeClaimNumber: false });

  }
 
  if (practiceArea) {
    conditions.push("practice_area = ?");
    values.push(practiceArea);
  }
 
  if (uid) {
    conditions.push("(uid = ? OR assigned_attorney_uid = ?)");
    values.push(uid, uid);
  }
 
  if (assignedAttorney) {
    conditions.push("assigned_attorney = ?");
    values.push(assignedAttorney);
  }
 
  if (req.query.custom_fields) {
    try {
      const customFields = JSON.parse(req.query.custom_fields);
      applyCustomQueriesToWhere(customFields, conditions, values);
    } catch (err) {
      console.error("Failed to parse custom fields:", err);
    }
  }
 
  if (startDate && endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) BETWEEN ? AND ?");
    values.push(startDate, endDate);
  } else if (startDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) >= ?");
    values.push(startDate);
  } else if (endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) <= ?");
    values.push(endDate);
  }
 
  if (closeDateStatus === "open") {
    conditions.push("(COALESCE(closed_date, '') = '')");
  } else if (closeDateStatus === "closed") {
    conditions.push("(COALESCE(closed_date, '') != '')");
  }
 
  let selectedColumns = [
    'case_id',
    'name',
    'case_number',
    'practice_area',
    'assigned_attorney',
    'case_stage',
    'opened_date',
    'date_of_damage',
    'closed_date',
    'insured_property',
    'policy_number',
    'date_of_loss',
    'pa_estimate',
    '`undisputed/prior_payment`',
    'claim_number',
    'clients_phone_number',
    'clients_email',
    'coverage_determination',
    'type_of_loss_specify',
    'type_of_loss_automated'
  ];
 
  if (req.query.custom_fields) {
    try {
      const customFields = JSON.parse(req.query.custom_fields);
      const customFieldNames = customFields.map((f) => f.field_name).filter(Boolean);
      selectedColumns = mergeSelectedColumns(selectedColumns, customFieldNames);
    } catch (err) {
      console.error("Failed to parse custom fields for selection:", err);
    }
  }
 
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT ${selectedColumns.join(", ")} FROM cases ${whereClause} ORDER BY ${sort}`;
 
  db.query(query, values, (err, results) => {
    if (err) {
      console.error("Export fetch error:", err);
      return res.status(500).send("Failed to fetch export data.");
    }
    res.json({ cases: results });
  });
});

/* ---------------- POST /cases/export (body-based) ---------------- */
router.post("/cases/export", (req, res) => {
  const src = getFilterSource(req);
  const sort = src.sort || "STR_TO_DATE(opened_date, '%m/%d/%y') DESC";
  // const caseStage = src.case_stage || "";
  const caseStageRaw = src.case_stage;
  const caseStages = Array.isArray(caseStageRaw) ? caseStageRaw.filter(Boolean) : (caseStageRaw ? [caseStageRaw] : []);
  const search = src.search || "";
  // const practiceArea = src.practice_area || "";

  const practiceAreaRaw = src.practice_area;
  const practiceAreas = Array.isArray(practiceAreaRaw) ? practiceAreaRaw.filter(Boolean) : (practiceAreaRaw ? [practiceAreaRaw] : []);
  const startDate = src.start_date || "";
  const endDate = src.end_date || "";
  const uid = src.uid || "";
  const assignedAttorney = src.assigned_attorney || "";
  const closeDateStatus = src.close_date_status || "";
  const reportUid = src.report_uid || "";

  let conditions = [];
  let values = [];

  // if (caseStage) { conditions.push("case_stage = ?"); values.push(caseStage); }
  if (caseStages.length === 1) {
    conditions.push("case_stage = ?");
    values.push(caseStages[0]);
  } else if (caseStages.length > 1) {
    conditions.push(`case_stage IN (${caseStages.map(() => '?').join(',')})`);
    values.push(...caseStages);
  }
  // if (search) { conditions.push("(name LIKE ? OR case_number LIKE ?)"); values.push(`%${search}%`, `%${search}%`); }
   if (search) {
    pushCaseSearchConditions(search, conditions, values, { includeClaimNumber: false });
  }
  // if (practiceArea) { conditions.push("practice_area = ?"); values.push(practiceArea); }
 if (practiceAreas.length === 1) {
    conditions.push("practice_area = ?");
    values.push(practiceAreas[0]);
  } else if (practiceAreas.length > 1) {
    conditions.push(`practice_area IN (${practiceAreas.map(() => '?').join(',')})`);
    values.push(...practiceAreas);
  }
  if (reportUid) {
    conditions.push("(uid = ? OR assigned_attorney_uid = ?)");
    values.push(reportUid, reportUid);
  } else if (uid) {
    conditions.push("(uid = ? OR assigned_attorney_uid = ?)");
    values.push(uid, uid);
  }
  if (assignedAttorney) { conditions.push("assigned_attorney = ?"); values.push(assignedAttorney); }

  const { includeFields, queries } = normalizeCustomFieldsForSelection(src.custom_fields);
  applyCustomQueriesToWhere(queries, conditions, values);

  if (startDate && endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) BETWEEN ? AND ?");
    values.push(startDate, endDate);
  } else if (startDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) >= ?");
    values.push(startDate);
  } else if (endDate) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) <= ?");
    values.push(endDate);
  }

  if (closeDateStatus === "open") {
    conditions.push("(COALESCE(closed_date, '') = '')");
  } else if (closeDateStatus === "closed") {
    conditions.push("(COALESCE(closed_date, '') != '')");
  }

  let selectedColumns = [
    'case_id','name','case_number','practice_area','assigned_attorney','case_stage',
    'opened_date','date_of_damage','closed_date','insured_property','policy_number',
    'date_of_loss','pa_estimate','`undisputed/prior_payment`','claim_number',
    'clients_phone_number','clients_email','coverage_determination',
    'type_of_loss_specify','type_of_loss_automated'
  ];
  selectedColumns = mergeSelectedColumns(selectedColumns, includeFields);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT ${selectedColumns.join(", ")} FROM cases ${whereClause} ORDER BY ${sort}`;

  db.query(query, values, (err, results) => {
    if (err) {
      console.error("Export fetch error (POST):", err);
      return res.status(500).send("Failed to fetch export data.");
    }
    // res.json({ cases: results });
    const casesList = results || [];
    const caseIds = casesList.map((r) => r.case_id).filter((id) => id != null);
    if (caseIds.length === 0) {
      const withAmounts = casesList.map((c) => ({
        ...c,
        billable_amount: 0,
        non_billable_amount: 0,
        billable_expenses: 0,
        non_billable_expenses: 0,
      }));
      // return res.json({ cases: withAmounts });
        return enrichCasesWithNextEventAndTask(withAmounts, (enrichedCases) => {
        res.json({ cases: enrichedCases });
      });
    }
    const placeholders = caseIds.map(() => "?").join(",");
    const amountsQuery = `
      SELECT case_id,
        COALESCE(SUM(CASE WHEN billable = 1 THEN rate * hours ELSE 0 END), 0) AS billable_amount,
        COALESCE(SUM(CASE WHEN billable = 0 THEN rate * hours ELSE 0 END), 0) AS non_billable_amount
      FROM time_entries
      WHERE case_id IN (${placeholders})
      GROUP BY case_id
    `;
    const expensesQuery = `
      SELECT case_id,
        COALESCE(SUM(CASE WHEN billable = 1 THEN cost * units ELSE 0 END), 0) AS billable_expenses,
        COALESCE(SUM(CASE WHEN billable = 0 THEN cost * units ELSE 0 END), 0) AS non_billable_expenses
      FROM expenses
      WHERE case_id IN (${placeholders})
      GROUP BY case_id
    `;
    db.query(amountsQuery, caseIds, (errAmounts, amountsRows) => {
      if (errAmounts) {
        console.error("Export: error fetching billable amounts:", errAmounts);
        const withAmounts = casesList.map((c) => ({
          ...c,
          billable_amount: 0,
          non_billable_amount: 0,
          billable_expenses: 0,
          non_billable_expenses: 0,
        }));
        // return res.json({ cases: withAmounts });
         return enrichCasesWithNextEventAndTask(withAmounts, (enrichedCases) => {
          res.json({ cases: enrichedCases });
        });
      }
      const amountByCaseId = (amountsRows || []).reduce((acc, row) => {
        acc[row.case_id] = {
          billable_amount: parseFloat(row.billable_amount) || 0,
          non_billable_amount: parseFloat(row.non_billable_amount) || 0,
        };
        return acc;
      }, {});
      db.query(expensesQuery, caseIds, (errExp, expensesRows) => {
        if (errExp) {
          console.error("Export: error fetching expense amounts:", errExp);
        }
        const expenseByCaseId = (expensesRows || []).reduce((acc, row) => {
          acc[row.case_id] = {
            billable_expenses: parseFloat(row.billable_expenses) || 0,
            non_billable_expenses: parseFloat(row.non_billable_expenses) || 0,
          };
          return acc;
        }, {});
        const withAmounts = casesList.map((c) => ({
          ...c,
          billable_amount: amountByCaseId[c.case_id]?.billable_amount ?? 0,
          non_billable_amount: amountByCaseId[c.case_id]?.non_billable_amount ?? 0,
          billable_expenses: expenseByCaseId[c.case_id]?.billable_expenses ?? 0,
          non_billable_expenses: expenseByCaseId[c.case_id]?.non_billable_expenses ?? 0,
        }));
        // res.json({ cases: withAmounts });
          enrichCasesWithNextEventAndTask(withAmounts, (enrichedCases) => {
          res.json({ cases: enrichedCases });
        });
      });
    });
  });
});

/* ---------------- POST /cases (create) ---------------- */
router.post("/cases", async (req, res) => {
  // If this looks like a search payload (no 'name' but has filters), delegate to list handler.
  if (!req.body?.name && (req.body?.page !== undefined || req.body?.custom_fields || req.body?.practice_area !== undefined || req.body?.case_stage !== undefined)) {
    return handleCasesListPost(req, res);
  }

  const payload = req.body;
  const requiredFields = ["name"];

  // Check for missing required fields
  const missingFields = requiredFields.filter(field => !payload[field]);
  if (missingFields.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
  }

  // Fetch valid column names from the database
  let validColumns = await getExistingColumns();
  const columnMap = validColumns.reduce((map, col) => {
    map[col.toLowerCase()] = col;
    return map;
  }, {});

  // Ensure UID is included (either provided or generated)
  // Use UID from the request header (e.g., 'x-user-uid')
  const userUid = req.headers['x-user-uid'];
  if (!userUid) {
    return res.status(401).json({ error: "User UID missing in request headers" });
  }
  payload.uid = userUid;

  // Filter payload to include only existing columns
  const columns = [];
  const values = [];
  const placeholders = [];

  for (const [key, value] of Object.entries(payload)) {
    const actualColumn = columnMap[key.toLowerCase()];
    if (actualColumn) { // Only include existing columns
      columns.push(actualColumn);
      values.push(value);
      placeholders.push("?");
    }
  }

  if (columns.length === 0) {
    return res.status(400).json({ error: "No valid fields provided" });
  }

  // Construct and execute the query
  const query = `INSERT INTO cases (${columns.map(col => `\`${col}\``).join(", ")}) VALUES (${placeholders.join(", ")})`;

  try {
    const [result] = await db.promise().query(query, values);
    // Log the creation activity
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
    });
    
    // Format to `YYYY-MM-DD HH:mm:ss`
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedTimestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
    
    await db.promise().query(
      "INSERT INTO case_activity_logs (uid, case_id, action, timestamp) VALUES (?, ?, ?, ?)",
      [payload.uid, result.insertId, 'create', formattedTimestamp]
    );
    

    res.status(201).json({
      message: "Case created successfully",
      caseId: result.insertId,
      uid: payload.uid, // Return UID in response
    });
  } catch (err) {
    console.error("Error creating case:", err);
    res.status(500).json({ error: "Error creating case" });
  }
});

/* ---------------- PUT /cases/:case_id (update) ---------------- */
router.put("/cases/:case_id", async (req, res) => {
  const { case_id } = req.params;
  const payload = req.body;

  if (!case_id) {
    return res.status(400).json({ error: "Case ID is required" });
  }

  // Define fields that should not be logged at all
  const NO_LOG_FIELDS = ['assigned_attorney_uid'];

  // First get the current case data to compare changes
  let currentCaseData = {};
  try {
    const [rows] = await db.promise().query("SELECT * FROM cases WHERE case_id = ?", [case_id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    currentCaseData = rows[0];
  } catch (err) {
    console.error("Error fetching current case data:", err);
    return res.status(500).json({ error: "Error fetching case data" });
  }

  const validColumns = await getExistingColumns();
  const columnMap = validColumns.reduce((map, col) => {
    map[col.toLowerCase()] = col;
    return map;
  }, {});

  const updates = [];
  const values = [];
  const changes = []; // To track what fields changed (excluding no-log fields)

  for (const [key, value] of Object.entries(payload)) {
    const actualColumn = columnMap[key.toLowerCase()];
    if (actualColumn) {
      let currentValue = currentCaseData[actualColumn];
  
      // Skip if this is a no-log field
      if (NO_LOG_FIELDS.includes(actualColumn.toLowerCase())) {
        updates.push(`\`${actualColumn}\` = ?`);
        values.push(value);
        continue; // Skip adding to changes array
      }

      // Normalize dates before comparing
      if (
        currentValue instanceof Date ||
        (typeof currentValue === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(currentValue))
      ) {
        const normalizedCurrent = new Date(currentValue).toISOString().split('T')[0];
        const normalizedNew = new Date(value).toISOString().split('T')[0];
        
        if (normalizedCurrent !== normalizedNew) {
          updates.push(`\`${actualColumn}\` = ?`);
          values.push(value);
          changes.push({
            field: actualColumn,
            oldValue: currentValue,
            newValue: value
          });
        }
      } else {
        const normalizeHtml = (html) => html.replace(/\s+/g, '').replace(/<br\s*\/?>/gi, '');

        if (
          typeof currentValue === 'string' &&
          typeof value === 'string' &&
          normalizeHtml(currentValue) === normalizeHtml(value)
        ) {
          continue; // Skip this field, values are practically the same
        }
        if ((currentValue ?? "") !== (value ?? "")) {
          updates.push(`\`${actualColumn}\` = ?`);
          values.push(value);
          changes.push({
            field: actualColumn,
            oldValue: currentValue,
            newValue: value
          });
        }
      }
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided for update" });
  }

  values.push(case_id);

  const query = `UPDATE cases SET ${updates.join(", ")} WHERE case_id = ?`;

  try {
    const [result] = await db.promise().query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Case not found" });
    }

    const userUid = req.headers['x-user-uid'];
    if (!userUid) {
      return res.status(401).json({ error: "User UID missing in request headers" });
    }

    // Format timestamp
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
    });
    
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedTimestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
    
    // Only log changes for fields that aren't in NO_LOG_FIELDS
    for (const change of changes) {
      await db.promise().query(
        "INSERT INTO case_activity_logs (uid, case_id, action, field_name, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userUid, case_id, 'update', change.field, change.oldValue, change.newValue, formattedTimestamp]
      );
    }

    res.json({ message: "Case updated successfully", changes });
  } catch (err) {
    console.error("Error updating case:", err);
    res.status(500).json({ error: "Error updating case" });
  }
});

/* ---------------- Remaining routes (unchanged) ---------------- */

// GET /cases/:id – fetch a single case with its events and notes
router.get("/cases/:id(\\d+)", (req, res) => {
  const caseId = req.params.id;
  const userUid = req.headers['x-user-uid']; // ✅ Get UID of current user
 
  if (!userUid) {
    return res.status(401).send("Unauthorized: Missing user ID");
  }
 
  const caseQuery = "SELECT * FROM cases WHERE case_id = ?";
  const eventsQuery = `
    SELECT id, case_name, event_name, event_description, start_event, end_event
    FROM case_events
    WHERE case_id = ?
    ORDER BY start_event ASC
  `;
  const notesQuery = `
    SELECT subject, note, date
    FROM case_notes
    WHERE case_id = ?
    ORDER BY STR_TO_DATE(date, '%m/%d/%Y') DESC
  `;
 
  db.query(caseQuery, [caseId], (err, caseResult) => {
    if (err) {
      console.error("Error fetching case details:", err);
      return res.status(500).send("Error fetching case details.");
    }
 
    if (caseResult.length === 0) {
      return res.status(404).send("Case not found.");
    }
 
    const caseData = caseResult[0];
 
    // ✅ First check user_case_assignments for access
    const permissionQuery = `
      SELECT COUNT(*) AS access_granted
      FROM user_case_assignments
      WHERE uid = ? AND case_id = ?
    `;
 
    db.query(permissionQuery, [userUid, caseId], (err, permissionResult) => {
      if (err) {
        console.error("Error checking user-case assignment:", err);
        return res.status(500).send("Permission check failed.");
      }
 
      const hasAccess = permissionResult[0]?.access_granted > 0;
 
      const assignedUids = [
        caseData.assigned_attorney_uid,
        caseData.paralegal_uid,
        caseData.created_by_uid
      ].filter(Boolean); // remove nulls
 
      if (!hasAccess && !assignedUids.includes(userUid)) {
        // 🔍 Check user_practice_areas if not directly assigned
        const practiceAreaQuery = `
          SELECT COUNT(*) AS matched
          FROM user_practice_areas
          WHERE uid = ? AND practice_area = ?
        `;
 
        db.query(practiceAreaQuery, [userUid, caseData.practice_area], (err, paResult) => {
          if (err) {
            console.error("Error checking practice area access:", err);
            return res.status(500).send("Practice area access check failed.");
          }
 
          const hasPracticeAreaAccess = paResult[0]?.matched > 0;
 
          if (!hasPracticeAreaAccess) {
            // ✅ New fallback: Check if the user has no permissions at all
            const checkAnyPermissions = `
              SELECT
                (SELECT COUNT(*) FROM user_case_assignments WHERE uid = ?) AS case_assignments,
                (SELECT COUNT(*) FROM user_practice_areas WHERE uid = ?) AS practice_assignments
            `;
 
            db.query(checkAnyPermissions, [userUid, userUid], (err, permissionResult) => {
              if (err) {
                console.error("Error checking overall permissions:", err);
                return res.status(500).send("Final access check failed.");
              }
 
              const hasAnyPermissions =
                permissionResult[0].case_assignments > 0 || permissionResult[0].practice_assignments > 0;
 
              if (!hasAnyPermissions) {
                // ✅ Allow access if user has no restrictions assigned yet
                return fetchEventsAndNotes(caseData);
              } else {
                return res.status(403).send("You are not assigned to this case.");
              }
            });
          } else {
            // ✅ Practice area matched, allow
            fetchEventsAndNotes(caseData);
          }
        });
      } else {
        // ✅ Directly assigned, allow
        fetchEventsAndNotes(caseData);
      }
    });
  });
 
  function fetchEventsAndNotes(caseData) {
    db.query(eventsQuery, [caseId], (err, eventsResult) => {
      if (err) {
        console.error("Error fetching case events:", err);
        return res.status(500).send("Error fetching case events.");
      }
 
      db.query(notesQuery, [caseId], (err, notesResult) => {
        if (err) {
          console.error("Error fetching case notes:", err);
          return res.status(500).send("Error fetching case notes.");
        }
 
        res.json({
          ...caseData,
          events: eventsResult,
          notes: notesResult,
        });
      });
    });
  }
});

router.get("/cases/all", (req, res) => {
  const allCasesQuery = `
    SELECT 
      case_id, 
      name, 
      case_number, 
      practice_area, 
      assigned_attorney, 
      case_stage, 
      opened_date, 
      date_of_damage 
    FROM cases 
    WHERE date_of_damage IS NOT NULL AND date_of_damage != '' 
    ORDER BY STR_TO_DATE(opened_date, '%m/%d/%y') DESC;
  `;

  db.query(allCasesQuery, (err, results) => {
    if (err) {
      console.error("Error fetching cases:", err);
      return res.status(500).send("Error fetching cases.");
    }

    res.json({ cases: results });
  });
});

// GET /cases/open – return only open cases (no closed_date)
router.get("/cases/open", (req, res) => {
  const openCasesQuery = `
    SELECT 
      case_id, 
      name, 
      case_number, 
      practice_area, 
      assigned_attorney, 
      case_stage, 
      opened_date, 
      date_of_damage, 
      closed_date,
      insured_property,
      policy_number,
      date_of_loss,
      pa_estimate,
      claim_number,
      clients_phone_number,
      clients_email,
      coverage_determination,
      type_of_loss_specify,
      type_of_loss_automated,
      assigned_attorney,
       paralegal_assignment,
       case_stage,
       practice_area,
       scheduling_assignment,
       last_offer_of_settlement,
       attorneys_fee_settlement,
        \`1696_faxed_date\`,
       form_1696_status,
       \`1696_processed\`,
       ere_access,
       \`local_ssa_office_fax_#\`,
       \`claim_status_date_(ssi/ssdi)\`

  FROM cases
    WHERE COALESCE(closed_date, '') = ''
    ORDER BY STR_TO_DATE(opened_date, '%m/%d/%y') DESC;
  `;
  db.query(openCasesQuery, (err, results) => {
    if (err) {
      console.error("Error fetching open cases:", err);
      return res.status(500).send("Error fetching open cases.");
    }
    res.json({ cases: results });
  });
});

router.get("/cases/:case_id/recent-activity", async (req, res) => { 
  const { case_id } = req.params;

  try {
    const [rows] = await db.promise().query(
      `SELECT 
        log.*,
        c.name AS case_name,
        c.case_number,
        au.first_name,
        au.last_name
      FROM case_activity_logs log
      JOIN cases c ON log.case_id = c.case_id
      LEFT JOIN active_users au ON log.uid = au.uid
      WHERE log.case_id = ?
      ORDER BY log.timestamp DESC
      LIMIT 50`,
      [case_id]
    );

    // Format the activity messages
    const formattedActivities = rows.map(activity => {
      if (activity.action === 'update' && activity.field_name) {
        return {
          ...activity,
          message: `${activity.field_name} changed from "${activity.old_value}" to "${activity.new_value}" by ${activity.first_name} ${activity.last_name} at ${new Date(activity.timestamp).toLocaleString()}`
        };
      } else if (activity.action === 'create') {
        return {
          ...activity,
          message: `Case created by ${activity.first_name} ${activity.last_name} at ${new Date(activity.timestamp).toLocaleString()}`
        };
      }
      return activity;
    });

    res.json(formattedActivities);
  } catch (err) {
    console.error("Error fetching recent activity:", err);
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

router.get("/casess/recent-activity", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT 
        log.*,
        c.name AS case_name,
        c.case_number,
        au.first_name,
        au.last_name
      FROM case_activity_logs log
      JOIN cases c ON log.case_id = c.case_id
      LEFT JOIN active_users au ON log.uid = au.uid
      ORDER BY log.timestamp DESC
      LIMIT 50`
    );

    const formattedActivities = formatActivities(rows);
    res.json(formattedActivities);
  } catch (err) {
    console.error("Error fetching all recent activity:", err);
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

router.get("/casesbillexpense/:case_id", (req, res) => {
  const caseId = req.params.case_id;
  const limit = 20;

  const positionQuery = `
    SELECT COUNT(*) + 1 AS position 
    FROM cases 
    WHERE STR_TO_DATE(opened_date, '%m/%d/%y') > 
          STR_TO_DATE((SELECT opened_date FROM cases WHERE case_id = ?), '%m/%d/%y')
  `;

  db.query(positionQuery, [caseId], (err, positionResult) => {
    if (err) {
      console.error("Error fetching case position:", err);
      return res.status(500).send("Error fetching case position.");
    }

    if (!positionResult.length || positionResult[0].position === undefined) {
      return res.status(404).send("Case not found.");
    }

    const position = positionResult[0].position;
    const page = Math.ceil(position / limit);
    const offset = (page - 1) * limit;

    const paginatedCasesQuery = `
      SELECT case_id, name, case_number, practice_area, assigned_attorney, case_stage, opened_date
      FROM cases
      ORDER BY STR_TO_DATE(opened_date, '%m/%d/%y') DESC
      LIMIT ? OFFSET ?
    `;

    db.query(paginatedCasesQuery, [limit, offset], (err, paginatedResults) => {
      if (err) {
        console.error("Error fetching cases:", err);
        return res.status(500).send("Error fetching cases.");
      }

      res.json({
        page,
        cases: paginatedResults,
      });
    });
  });
});

// POST /generate-document – spawn Python process and download document
router.post("/generate-document", (req, res) => {
  const { case_id: caseId, template_filename: templateFilename } = req.body;

  if (!caseId || !templateFilename) {
    return res.status(400).json({ error: "Missing case_id or template_filename" });
  }

  const pythonProcess = spawn(pythonPath, ["generate_doc.py", caseId, templateFilename]);

  let chunks = [];
  let errorData = "";

  pythonProcess.stdout.on("data", (data) => {
    chunks.push(data);
  });

  pythonProcess.stderr.on("data", (data) => {
    errorData += data.toString();
  });

  pythonProcess.on("close", (code) => {
    if (code !== 0 || errorData) {
      console.error("Python script error:", errorData);
      return res.status(500).json({ error: "Error generating document", details: errorData });
    }

    const buffer = Buffer.concat(chunks);

    res.setHeader("Content-Disposition", `attachment; filename="${templateFilename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  });
});

router.post("/generate-documentESIGN", (req, res) => {
  const { case_id: caseId, template_filename: templateFilename } = req.body;
 
  if (!caseId || !templateFilename) {
    return res.status(400).json({ error: "Missing case_id or template_filename in request body" });
  }
 
  const pythonProcess = spawn(pythonPath, ["generate_pdf.py", caseId, templateFilename]);
 
  let outputData = "";
  let errorData = "";
 
  pythonProcess.stdout.on("data", (data) => {
    outputData += data.toString();
  });
 
  pythonProcess.stderr.on("data", (data) => {
    errorData += data.toString();
  });
 
  pythonProcess.on("close", (code) => {
    if (code !== 0) {
      console.error("Python script error:", errorData);
      return res.status(500).json({ error: "Error generating document", details: errorData });
    }
 
    const docPath = path.join(__dirname, "..", "case-eSignTemplate", caseId, templateFilename);
 
    res.download(docPath, templateFilename, (err) => {
      if (err) {
        console.error("Error sending document:", err);
        res.status(500).json({ error: "Error sending document" });
      }
    });
  });
});

/* ---- (Your utility routes below remain unchanged) ---- */

router.get("/api/getUserName/:uid", (req, res) => {
  const { uid } = req.params;
  const query = "SELECT name FROM active_users WHERE uid = ?";
  db.query(query, [uid], (err, result) => {
    if (err) {
      console.error("Error fetching user name:", err);
      return res.status(500).send("Error fetching user name.");
    }
    if (result.length === 0) {
      return res.status(404).send("User not found.");
    }
    res.json({ name: result[0].name });
  });
});

router.post("/api/update-permissions", (req, res) => {
  const { uid, case_ids = [], practice_areas = [] } = req.body;
    const accessAllCases = case_ids.length === 0 && practice_areas.length === 0 ? 1 : 0;

  if (!uid) {
    return res.status(400).json({ message: "Missing uid" });
  }
  const deleteCasesQuery = `DELETE FROM user_case_assignments WHERE uid = ?`;
  const deletePracticeQuery = `DELETE FROM user_practice_areas WHERE uid = ?`;
  const insertCasesQuery = `INSERT INTO user_case_assignments (uid, case_id) VALUES ?`;
  const insertPracticeQuery = `INSERT INTO user_practice_areas (uid, practice_area) VALUES ?`;
 
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Connection error:", err);
      return res.status(500).json({ message: "Failed to get DB connection" });
    }
    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("Transaction start error:", err);
        return res.status(500).json({ message: "Transaction error" });
      }
      const deleteCasesQuery = `DELETE FROM user_case_assignments WHERE uid = ?`;
      const deletePracticeQuery = `DELETE FROM user_practice_areas WHERE uid = ?`;
      const insertCasesQuery = `INSERT INTO user_case_assignments (uid, case_id) VALUES ?`;
      const insertPracticeQuery = `INSERT INTO user_practice_areas (uid, practice_area) VALUES ?`;
 
      connection.query(deleteCasesQuery, [uid], (err) => {
        if (err) return rollback("Delete case_ids failed");
        connection.query(deletePracticeQuery, [uid], (err) => {
          if (err) return rollback("Delete practice_areas failed");
 
          const caseValues = case_ids.map((id) => [uid, id]);
          const practiceValues = practice_areas.map((area) => [uid, area]);
 
          const insertCases = caseValues.length
            ? (cb) => connection.query(insertCasesQuery, [caseValues], cb)
            : (cb) => cb(null);
 
          const insertPractice = practiceValues.length
            ? (cb) => connection.query(insertPracticeQuery, [practiceValues], cb)
            : (cb) => cb(null);
 
          insertCases((err) => {
            if (err) return rollback("Insert case_ids failed");
            insertPractice((err) => {
              if (err) return rollback("Insert practice_areas failed");
              connection.query(
                "UPDATE active_users SET access_all_cases = ?, updated_at = NOW() WHERE uid = ?",
                [accessAllCases, uid],
                (err) => {
                  if (err) return rollback("Update access_all_cases failed");
              connection.commit((err) => {
                if (err) return rollback("Commit failed");
                connection.release();
                res.json({ message: "Permissions updated successfully" });
              });
               }
              );
            });
          });
        });
      });
 
      function rollback(message) {
        connection.rollback(() => {
          connection.release();
          console.error(message);
          res.status(500).json({ message });
        });
      }
    });
  });
});

router.get("/api/user-permissions", (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ message: "Missing uid" });
 
  const caseQuery = "SELECT case_id FROM user_case_assignments WHERE uid = ?";
  const areaQuery = "SELECT practice_area FROM user_practice_areas WHERE uid = ?";
 
  db.query(caseQuery, [uid], (err, caseResults) => {
    if (err) return res.status(500).json({ message: "Error fetching cases" });
    db.query(areaQuery, [uid], (err2, areaResults) => {
      if (err2) return res.status(500).json({ message: "Error fetching areas" });
      const case_ids = caseResults.map(row => row.case_id);
      const practice_area = areaResults.map(row => row.practice_area);
      res.json({ case_ids, practice_area });
    });
  });
});

router.post("/api/recent-search", async (req, res) => {
  const { uid, case_id, case_name } = req.body;
  if (!uid || !case_id) {
    return res.status(400).json({ error: "Missing uid or case_id" });
  }
  try {
    const [updateResult] = await db.promise().query(
      `UPDATE recent_case_searches
       SET searched_at = NOW(), case_name = ?
       WHERE uid = ? AND case_id = ?`,
      [case_name, uid, case_id]
    );
    if (!updateResult.affectedRows) {
      await db.promise().query(
        `INSERT INTO recent_case_searches (uid, case_id, case_name, searched_at)
         VALUES (?, ?, ?, NOW())`,
        [uid, case_id, case_name]
      );
    }
    await db.promise().query(
      `DELETE FROM recent_case_searches
       WHERE uid = ? AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM recent_case_searches
           WHERE uid = ?
           ORDER BY searched_at DESC
           LIMIT 5
         ) recent
       )`,
      [uid, uid]
    );
    res.json({ message: "Recent search recorded" });
  } catch (err) {
    console.error("Error recording recent search:", err);
    res.status(500).json({ error: "Failed to record search" });
  }
});

router.get("/api/recent-searches/:uid", async (req, res) => {
  const { uid } = req.params;
  const limit = parseInt(req.query.limit) || 5;
  const offset = parseInt(req.query.offset) || 0;
  if (!uid) return res.status(400).json({ error: "Missing uid" });
  try {
    const [rows] = await db.promise().query(
      `SELECT case_id, case_name FROM recent_case_searches
       WHERE uid = ?
       ORDER BY searched_at DESC
       LIMIT 5`,
      [uid, limit, offset]
    );
    res.json({ recentCases: rows });
  } catch (err) {
    console.error("Error fetching recent searches:", err);
    res.status(500).json({ error: "Failed to fetch recent cases" });
  }
});

module.exports = router;