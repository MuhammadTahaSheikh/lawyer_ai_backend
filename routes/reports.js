const express = require("express");
const router = express.Router();
const db = require("../db");

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const EXCLUDED_ATTORNEYS = ["Pierre Louis", "Melissa Romero", "Magdaline Mintz"];

const ATTORNEY_KEYWORDS = ["attorney", "lawyer", "partner"];

function isAttorney(emp) {
  const type = (emp.type || "").toLowerCase();
  const title = (emp.title || "").toLowerCase();
  return ATTORNEY_KEYWORDS.some((kw) => type.includes(kw) || title.includes(kw));
}

function mapEmployeeData(emp) {
  return {
    staff_id: emp.staff_id,
    first_name: emp.first_name,
    last_name: emp.last_name,
    type: emp.type,
    title: emp.title,
    billableHours: parseFloat(emp.billable_hours || 0),
    nonBillableHours: parseFloat(emp.non_billable_hours || 0),
    totalHours: parseFloat(emp.billable_hours || 0) + parseFloat(emp.non_billable_hours || 0),
    billableAmount: parseFloat(emp.total_billable_amount || 0),
    billableFlatFees: parseFloat(emp.billable_flat_fees || 0),
    billableExpenses: parseFloat(emp.billable_expenses || 0),
    nonBillableExpenses: parseFloat(emp.non_billable_expenses || 0),
    closureCount: parseInt(emp.closure_count || 0),
  };
}

function isValidDateString(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function getRequestingUid(req) {
  return req.query.uid || req.headers["x-user-uid"] || null;
}

function validateDates(req, res) {
  const { start_date, end_date } = req.query;
  if (start_date && !isValidDateString(start_date)) {
    res.status(400).json({ error: "Invalid start_date format. Expected YYYY-MM-DD." });
    return false;
  }
  if (end_date && !isValidDateString(end_date)) {
    res.status(400).json({ error: "Invalid end_date format. Expected YYYY-MM-DD." });
    return false;
  }
  return true;
}

// ─── POST /save_report ───────────────────────────────────────────────────────

router.post("/save_report", async (req, res) => {
  const { name, uid, filters, customFieldQueries, dateRange, selectedColumns } = req.body;

  if (!name || !uid) {
    return res.status(400).json({ error: "Missing required fields: name or uid." });
  }

  const query = `
    INSERT INTO saved_reports (name, uid, filters, custom_field_queries, date_range, selected_columns)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const values = [
    name,
    uid,
    JSON.stringify(filters),
    JSON.stringify(customFieldQueries),
    dateRange || "",
    JSON.stringify(selectedColumns || []),
  ];

  try {
    const [result] = await db.promise().query(query, values);
    res.status(201).json({
      message: "Report saved successfully.",
      report_id: result.insertId,
    });
  } catch (err) {
    console.error("Error saving report:", err);
    res.status(500).json({ error: "Failed to save report." });
  }
});

// ─── PUT /saved_reports/:id ──────────────────────────────────────────────────

router.put("/saved_reports/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "Report name is required." });

  try {
    // Ownership check
    const requestingUid = getRequestingUid(req);
    if (requestingUid) {
      const [rows] = await db.promise().query("SELECT uid FROM saved_reports WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ error: "Report not found." });
      if (rows[0].uid && rows[0].uid !== requestingUid) {
        return res.status(403).json({ error: "You do not have permission to update this report." });
      }
    }

    const [result] = await db.promise().query("UPDATE saved_reports SET name = ? WHERE id = ?", [name, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Report not found." });
    res.status(200).json({ message: "Report name updated." });
  } catch (err) {
    console.error("Error updating report name:", err);
    res.status(500).json({ error: "Failed to update report name." });
  }
});

// ─── GET /saved_reports ──────────────────────────────────────────────────────

router.get("/saved_reports", async (req, res) => {
  const { uid } = req.query;

  if (!uid) return res.status(400).json({ error: "Missing uid." });

  const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
  const offset = req.query.offset ? parseInt(req.query.offset, 10) : null;
  const paginated = limit !== null || offset !== null;
  const effectiveLimit = limit || 50;
  const effectiveOffset = offset || 0;

  try {
    let query;
    let values;

    if (paginated) {
      query = `
        SELECT id, name, date_range, created_at, filters, custom_field_queries, selected_columns
        FROM saved_reports
        WHERE uid = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      values = [uid, effectiveLimit, effectiveOffset];
    } else {
      query = `
        SELECT id, name, date_range, created_at, filters, custom_field_queries, selected_columns
        FROM saved_reports
        WHERE uid = ?
        ORDER BY created_at DESC
      `;
      values = [uid];
    }

    const [results] = await db.promise().query(query, values);

    const parsedResults = results.map((report) => ({
      ...report,
      filters: typeof report.filters === "string" ? JSON.parse(report.filters) : report.filters,
      custom_field_queries:
        typeof report.custom_field_queries === "string"
          ? JSON.parse(report.custom_field_queries)
          : report.custom_field_queries,
      selected_columns:
        typeof report.selected_columns === "string"
          ? JSON.parse(report.selected_columns)
          : report.selected_columns,
    }));

    if (paginated) {
      const [countRows] = await db.promise().query(
        "SELECT COUNT(*) as total FROM saved_reports WHERE uid = ?",
        [uid]
      );
      const total = countRows[0].total;
      res.status(200).json({
        reports: parsedResults,
        pagination: {
          total,
          limit: effectiveLimit,
          offset: effectiveOffset,
          hasMore: effectiveOffset + effectiveLimit < total,
        },
      });
    } else {
      res.status(200).json(parsedResults);
    }
  } catch (err) {
    console.error("Error fetching saved reports:", err);
    res.status(500).json({ error: "Failed to fetch reports." });
  }
});

// ─── GET /user_reports ───────────────────────────────────────────────────────

router.get("/user_reports", async (req, res) => {
  const { start_date, end_date, selected_user } = req.query;

  if (!validateDates(req, res)) return;

  let conditions = [];
  let values = [];

  if (selected_user) {
    conditions.push("__ALIAS__.staff_id = ?");
    values.push(parseInt(selected_user, 10));
  }

  if (start_date) {
    conditions.push("DATE(__ALIAS__.entry_date) >= ?");
    values.push(start_date);
  }

  if (end_date) {
    conditions.push("DATE(__ALIAS__.entry_date) <= ?");
    values.push(end_date);
  }

  const buildWhere = (alias) => {
    if (conditions.length === 0) return "";
    return `WHERE ${conditions.map((c) => c.replace(/__ALIAS__/g, alias)).join(" AND ")}`;
  };

  const isExport = req.query.export === "true";
  const limit = isExport ? 10000 : parseInt(req.query.limit, 10) || 30;
  const offset = isExport ? 0 : parseInt(req.query.offset, 10) || 0;

  const paginatedValues = [...values, limit, offset];

  const timeEntriesQuery = `
    SELECT
      te.time_entry_id, te.description, te.entry_date, te.billable, te.case_id,
      te.staff_id, te.activity_name, te.rate, te.flat_fee, te.hours,
      c.name AS case_name, c.case_number,
      CONCAT(s.first_name, ' ', s.last_name) AS staff_name
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${buildWhere("te")}
    ORDER BY te.entry_date DESC
    LIMIT ? OFFSET ?
  `;

  const expensesQuery = `
    SELECT
      e.expense_id, e.description, e.entry_date, e.billable, e.case_id,
      e.staff_id, e.activity_name, e.units, e.cost
    FROM expenses e
    ${buildWhere("e")}
    ORDER BY e.entry_date DESC
    LIMIT ? OFFSET ?
  `;

  const totalExpensesSumQuery = `
    SELECT SUM(cost * units) AS total_expenses
    FROM expenses e
    ${buildWhere("e")}
  `;

  const timeTotalsQuery = `
    SELECT
      SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) AS billable_hours,
      SUM(CASE WHEN billable = 0 THEN hours ELSE 0 END) AS non_billable_hours,
      SUM(CASE WHEN billable = 1 THEN flat_fee ELSE 0 END) AS billable_flat_fees,
      SUM(CASE WHEN billable = 1 THEN (rate * hours) ELSE 0 END) AS total_billable_amount
    FROM time_entries te
    ${buildWhere("te")}
  `;

  const expenseTotalsQuery = `
    SELECT
      SUM(CASE WHEN billable = 1 THEN (cost * units) ELSE 0 END) AS billable_expenses,
      SUM(CASE WHEN billable = 0 THEN (cost * units) ELSE 0 END) AS non_billable_expenses
    FROM expenses e
    ${buildWhere("e")}
  `;

  try {
    const [
      [timeTotalsResult],
      [expenseTotalsResult],
      [timeEntriesResults],
      [expensesResults],
      [totalExpensesResult],
    ] = await Promise.all([
      db.promise().query(timeTotalsQuery, values),
      db.promise().query(expenseTotalsQuery, values),
      db.promise().query(timeEntriesQuery, paginatedValues),
      db.promise().query(expensesQuery, paginatedValues),
      db.promise().query(totalExpensesSumQuery, values),
    ]);

    const totalExpenses = totalExpensesResult[0]?.total_expenses || 0;

    res.json({
      time_entries: timeEntriesResults,
      expenses: expensesResults,
      total_expenses: totalExpenses,
      billable_hours: parseFloat(timeTotalsResult[0].billable_hours || 0),
      non_billable_hours: parseFloat(timeTotalsResult[0].non_billable_hours || 0),
      billable_flat_fees: parseFloat(timeTotalsResult[0].billable_flat_fees || 0),
      total_billable_amount: parseFloat(timeTotalsResult[0].total_billable_amount || 0),
      billable_expenses: parseFloat(expenseTotalsResult[0].billable_expenses || 0),
      non_billable_expenses: parseFloat(expenseTotalsResult[0].non_billable_expenses || 0),
    });
  } catch (err) {
    console.error("Error fetching user reports:", err);
    res.status(500).json({ error: "Error fetching user reports." });
  }
});

// ─── GET /employee_milestones ────────────────────────────────────────────────

router.get("/employee_milestones", async (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date are required" });
  }
  if (!validateDates(req, res)) return;

  const excludePlaceholders = EXCLUDED_ATTORNEYS.map(() => "?").join(", ");

  const employeeMilestonesQuery = `
    SELECT
      au.staff_id,
      au.first_name,
      au.last_name,
      au.type,
      au.title,
      au.uid,
      COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN te.billable = 0 THEN te.hours ELSE 0 END), 0) AS non_billable_hours,
      COALESCE(SUM(CASE WHEN te.billable = 1 THEN (te.rate * te.hours) ELSE 0 END), 0) AS total_billable_amount,
      COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.flat_fee ELSE 0 END), 0) AS billable_flat_fees,
      COALESCE(SUM(CASE WHEN e.billable = 1 THEN (e.cost * e.units) ELSE 0 END), 0) AS billable_expenses,
      COALESCE(SUM(CASE WHEN e.billable = 0 THEN (e.cost * e.units) ELSE 0 END), 0) AS non_billable_expenses,
      COALESCE(closure_counts.closure_count, 0) AS closure_count,
      COALESCE(new_client_counts.new_client_count, 0) AS new_client_count

    FROM active_users au
    LEFT JOIN time_entries te ON au.staff_id = te.staff_id
      AND DATE(te.entry_date) >= ?
      AND DATE(te.entry_date) <= ?
    LEFT JOIN expenses e ON au.staff_id = e.staff_id
      AND DATE(e.entry_date) >= ?
      AND DATE(e.entry_date) <= ?
    LEFT JOIN (
      SELECT
        COALESCE(c.assigned_attorney_uid, au_match.uid) AS attorney_uid,
        COUNT(DISTINCT cal.case_id) AS closure_count
      FROM case_activity_logs cal
      INNER JOIN cases c ON cal.case_id = c.case_id
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      WHERE cal.field_name = 'practice_area'
        AND cal.new_value = 'PL Settled'
        AND DATE(cal.timestamp) >= ?
        AND DATE(cal.timestamp) <= ?
        AND c.practice_area = 'PL Settled'
        AND (c.assigned_attorney_uid IS NOT NULL OR au_match.uid IS NOT NULL)
        AND COALESCE(
          (SELECT CONCAT(first_name, ' ', last_name) FROM active_users WHERE uid = c.assigned_attorney_uid),
          c.assigned_attorney
        ) NOT IN (${excludePlaceholders})
      GROUP BY COALESCE(c.assigned_attorney_uid, au_match.uid)
    ) closure_counts ON au.uid = closure_counts.attorney_uid
       LEFT JOIN (
      SELECT
        COALESCE(c.assigned_attorney_uid, au_match.uid) AS attorney_uid,
        COUNT(DISTINCT c.case_id) AS new_client_count
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      WHERE (c.assigned_attorney_uid IS NOT NULL OR au_match.uid IS NOT NULL)
        AND DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) >= ?
        AND DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) <= ?
      GROUP BY COALESCE(c.assigned_attorney_uid, au_match.uid)
    ) new_client_counts ON au.uid = new_client_counts.attorney_uid
    WHERE au.active = 'Yes'
    AND (au.disabled IS NULL OR LOWER(TRIM(au.disabled)) <> 'yes')
    GROUP BY au.staff_id, au.first_name, au.last_name, au.type, au.title, au.uid, closure_counts.closure_count, new_client_counts.new_client_count

    ORDER BY billable_hours DESC
  `;

  try {
    const [results] = await db.promise().query(employeeMilestonesQuery, [
      start_date, end_date,
      start_date, end_date,
      start_date, end_date,
      ...EXCLUDED_ATTORNEYS,
      start_date, end_date,
    ]);

    res.json({
      attorneys: results.filter(isAttorney).map(mapEmployeeData),
      staff: results.filter((emp) => !isAttorney(emp)).map(mapEmployeeData),
    });
  } catch (err) {
    console.error("Error fetching employee milestones:", err);
    res.status(500).json({ error: "Error fetching employee milestones" });
  }
});

// ─── GET /employee_closure_cases ─────────────────────────────────────────────

router.get("/employee_closure_cases", async (req, res) => {
  const {
    staff_id,
    start_date,
    end_date,
    page = 1,
    limit = 20,
    sort_by = "date",
    sort_order = "desc",
  } = req.query;

  if (!staff_id) {
    return res.status(400).json({ error: "Staff ID is required" });
  }
  if (!validateDates(req, res)) return;

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  try {
    // Get employee uid
    const [uidResults] = await db.promise().query(
      "SELECT uid FROM active_users WHERE staff_id = ? LIMIT 1",
      [staff_id]
    );

    if (!uidResults.length || !uidResults[0].uid) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const employeeUid = uidResults[0].uid;

    let conditions = [];
    let values = [];

    conditions.push(`
      (
        c.assigned_attorney_uid = ? OR
        (c.assigned_attorney IS NOT NULL AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name) AND au_match.uid = ?)
      )
    `);
    values.push(employeeUid, employeeUid);

    conditions.push("c.practice_area = 'PL Settled'");

    const excludePlaceholders = EXCLUDED_ATTORNEYS.map(() => "?").join(", ");
    conditions.push(`
      COALESCE(
        (SELECT CONCAT(first_name, ' ', last_name) FROM active_users WHERE uid = c.assigned_attorney_uid),
        c.assigned_attorney
      ) NOT IN (${excludePlaceholders})
    `);
    values.push(...EXCLUDED_ATTORNEYS);

    if (start_date && end_date) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
            AND DATE(cal.timestamp) BETWEEN ? AND ?
        )
      `);
      values.push(start_date, end_date);
    } else if (start_date) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
            AND DATE(cal.timestamp) >= ?
        )
      `);
      values.push(start_date);
    } else if (end_date) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
            AND DATE(cal.timestamp) <= ?
        )
      `);
      values.push(end_date);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    let orderBy = "closure_date DESC";
    switch (sort_by) {
      case "case_name":
        orderBy = sort_order === "asc" ? "c.name ASC" : "c.name DESC";
        break;
      case "date":
      default:
        orderBy = sort_order === "asc" ? "closure_date ASC" : "closure_date DESC";
        break;
    }

    const casesQuery = `
      SELECT DISTINCT
        c.case_id,
        c.name as case_name,
        c.case_number,
        c.practice_area,
        c.case_stage,
        c.assigned_attorney,
        c.opened_date,
        (
          SELECT DATE(cal.timestamp)
          FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
          ORDER BY cal.timestamp DESC
          LIMIT 1
        ) as closure_date
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT c.case_id) as total
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
    `;

    const summaryQuery = `
      SELECT
        COUNT(DISTINCT c.case_id) as total_cases,
        MIN((
          SELECT DATE(cal.timestamp)
          FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
          ORDER BY cal.timestamp ASC
          LIMIT 1
        )) as earliest_closure_date,
        MAX((
          SELECT DATE(cal.timestamp)
          FROM case_activity_logs cal
          WHERE cal.case_id = c.case_id
            AND cal.field_name = 'practice_area'
            AND cal.new_value = 'PL Settled'
          ORDER BY cal.timestamp DESC
          LIMIT 1
        )) as latest_closure_date
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
    `;

    const queryValues = [...values, limitNumber, offset];

    const [[casesResults], [countResults], [summaryResults]] = await Promise.all([
      db.promise().query(casesQuery, queryValues),
      db.promise().query(countQuery, values),
      db.promise().query(summaryQuery, values),
    ]);

    res.json({
      cases: casesResults,
      pagination: {
        totalRecords: countResults[0].total,
        totalPages: Math.ceil(countResults[0].total / limitNumber),
        currentPage: pageNumber,
        recordsPerPage: limitNumber,
        hasMore: pageNumber < Math.ceil(countResults[0].total / limitNumber),
      },
      summary: {
        total_cases: summaryResults[0]?.total_cases || 0,
        earliest_closure_date: summaryResults[0]?.earliest_closure_date,
        latest_closure_date: summaryResults[0]?.latest_closure_date,
      },
    });
  } catch (err) {
    console.error("Error fetching closure cases:", err);
    res.status(500).json({ error: "Error fetching closure cases" });
  }
});

// ─── GET /employee_new_client_cases ──────────────────────────────────────────

router.get("/employee_new_client_cases", async (req, res) => {
  const {
    staff_id,
    start_date,
    end_date,
    page = 1,
    limit = 20,
    sort_by = "date",
    sort_order = "desc",
  } = req.query;

  if (!staff_id) {
    return res.status(400).json({ error: "Staff ID is required" });
  }
  if (!validateDates(req, res)) return;

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  try {
    const [uidResults] = await db.promise().query(
      "SELECT uid FROM active_users WHERE staff_id = ? LIMIT 1",
      [staff_id]
    );

    if (!uidResults.length || !uidResults[0].uid) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const employeeUid = uidResults[0].uid;

    const conditions = [
      `(
        c.assigned_attorney_uid = ? OR
        (c.assigned_attorney IS NOT NULL AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name) AND au_match.uid = ?)
      )`,
      `DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) IS NOT NULL`,
    ];
    const values = [employeeUid, employeeUid];

    if (start_date && end_date) {
      conditions.push(
        `DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) BETWEEN ? AND ?`
      );
      values.push(start_date, end_date);
    } else if (start_date) {
      conditions.push(
        `DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) >= ?`
      );
      values.push(start_date);
    } else if (end_date) {
      conditions.push(
        `DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) <= ?`
      );
      values.push(end_date);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    let orderBy = "opened_date_parsed DESC";
    switch (sort_by) {
      case "case_name":
        orderBy = sort_order === "asc" ? "c.name ASC" : "c.name DESC";
        break;
      case "date":
      default:
        orderBy = sort_order === "asc" ? "opened_date_parsed ASC" : "opened_date_parsed DESC";
        break;
    }

    const casesQuery = `
      SELECT DISTINCT
        c.case_id,
        c.name as case_name,
        c.case_number,
        c.practice_area,
        c.case_stage,
        c.assigned_attorney,
        c.opened_date,
        DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) as opened_date_parsed
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT c.case_id) as total
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
    `;

    const queryValues = [...values, limitNumber, offset];

    const [[casesResults], [countResults]] = await Promise.all([
      db.promise().query(casesQuery, queryValues),
      db.promise().query(countQuery, values),
    ]);

    const total = countResults[0].total;

    res.json({
      cases: casesResults,
      pagination: {
        totalRecords: total,
        totalPages: Math.ceil(total / limitNumber),
        currentPage: pageNumber,
        recordsPerPage: limitNumber,
        hasMore: pageNumber < Math.ceil(total / limitNumber),
      },
      summary: {
        total_cases: total,
      },
    });
  } catch (err) {
    console.error("Error fetching new client cases:", err);
    res.status(500).json({ error: "Error fetching new client cases" });
  }
});

// ─── GET /new_client_by_practice_area ────────────────────────────────────────

router.get("/new_client_by_practice_area", async (req, res) => {
  const { start_date, end_date, status = "open" } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date are required" });
  }
  if (!validateDates(req, res)) return;

  const conditions = ["c.created_at IS NOT NULL", "DATE(c.created_at) BETWEEN ? AND ?"];
  const values = [start_date, end_date];

  if (status === "open") {
    conditions.push("(COALESCE(c.closed_date, '') = '')");
  } else if (status === "closed") {
    conditions.push("(COALESCE(c.closed_date, '') != '')");
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(c.practice_area), ''), '(Unspecified)') AS practice_area,
      COUNT(DISTINCT c.case_id) AS count
    FROM cases c
    ${whereClause}
    GROUP BY COALESCE(NULLIF(TRIM(c.practice_area), ''), '(Unspecified)')
    ORDER BY count DESC
  `;

  try {
    const [results] = await db.promise().query(query, values);
    res.json({
      byPracticeArea: results.map((row) => ({
        practice_area: row.practice_area,
        count: parseInt(row.count || 0, 10),
      })),
    });
  } catch (err) {
    console.error("Error fetching new client by practice area:", err);
    res.status(500).json({ error: "Error fetching new client by practice area" });
  }
});

// ─── GET /new_client_cases_by_practice_area ──────────────────────────────────

router.get("/new_client_cases_by_practice_area", async (req, res) => {
  const {
    practice_area,
    start_date,
    end_date,
    status = "open",
    page = 1,
    limit = 20,
    sort_by = "date",
    sort_order = "desc",
  } = req.query;

  if (!practice_area) {
    return res.status(400).json({ error: "practice_area is required" });
  }
  if (!validateDates(req, res)) return;

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  const conditions = [
    `COALESCE(NULLIF(TRIM(c.practice_area), ''), '(Unspecified)') = ?`,
    `c.created_at IS NOT NULL`,
  ];
  const values = [practice_area];

  if (status === "open") {
    conditions.push("(COALESCE(c.closed_date, '') = '')");
  } else if (status === "closed") {
    conditions.push("(COALESCE(c.closed_date, '') != '')");
  }

  if (start_date && end_date) {
    conditions.push("DATE(c.created_at) BETWEEN ? AND ?");
    values.push(start_date, end_date);
  } else if (start_date) {
    conditions.push("DATE(c.created_at) >= ?");
    values.push(start_date);
  } else if (end_date) {
    conditions.push("DATE(c.created_at) <= ?");
    values.push(end_date);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  let orderBy = "c.created_at DESC";
  switch (sort_by) {
    case "case_name":
      orderBy = sort_order === "asc" ? "c.name ASC" : "c.name DESC";
      break;
    case "date":
    default:
      orderBy = sort_order === "asc" ? "c.created_at ASC" : "c.created_at DESC";
      break;
  }

  const casesQuery = `
    SELECT
      c.case_id,
      c.name as case_name,
      c.case_number,
      c.practice_area,
      c.case_stage,
      c.assigned_attorney,
      c.opened_date,
      c.created_at,
      DATE(c.created_at) as created_at_date
    FROM cases c
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT c.case_id) as total
    FROM cases c
    ${whereClause}
  `;

  const queryValues = [...values, limitNumber, offset];

  try {
    const [[casesResults], [countResults]] = await Promise.all([
      db.promise().query(casesQuery, queryValues),
      db.promise().query(countQuery, values),
    ]);

    const total = countResults[0].total;

    res.json({
      cases: casesResults,
      pagination: {
        totalRecords: total,
        totalPages: Math.ceil(total / limitNumber),
        currentPage: pageNumber,
        recordsPerPage: limitNumber,
        hasMore: pageNumber < Math.ceil(total / limitNumber),
      },
      summary: {
        total_cases: total,
      },
    });
  } catch (err) {
    console.error("Error fetching new client cases by practice area:", err);
    res.status(500).json({ error: "Error fetching new client cases" });
  }
});

// ─── GET /monthly_cases_opened_closed ────────────────────────────────────────

router.get("/monthly_cases_opened_closed", async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 6), 24);

  const openedQuery = `
    SELECT DATE_FORMAT(c.created_at, '%Y-%m') AS month, COUNT(DISTINCT c.case_id) AS opened
    FROM cases c
    WHERE c.created_at IS NOT NULL
      AND c.created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY DATE_FORMAT(c.created_at, '%Y-%m')
  `;

  const closedQuery = `
    SELECT DATE_FORMAT(cal.timestamp, '%Y-%m') AS month, COUNT(DISTINCT cal.case_id) AS closed
    FROM case_activity_logs cal
    INNER JOIN cases c ON cal.case_id = c.case_id AND c.practice_area = 'PL Settled'
    WHERE cal.field_name = 'practice_area'
      AND cal.new_value = 'PL Settled'
      AND cal.timestamp >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY DATE_FORMAT(cal.timestamp, '%Y-%m')
  `;

  try {
    const [[openedRows], [closedRows]] = await Promise.all([
      db.promise().query(openedQuery, [months]),
      db.promise().query(closedQuery, [months]),
    ]);

    const openedByMonth = {};
    (openedRows || []).forEach((r) => {
      openedByMonth[r.month] = parseInt(r.opened || 0, 10);
    });
    const closedByMonth = {};
    (closedRows || []).forEach((r) => {
      closedByMonth[r.month] = parseInt(r.closed || 0, 10);
    });

    const monthLabels = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const key = `${y}-${m}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      monthLabels.push({
        month: key,
        monthLabel: label,
        opened: openedByMonth[key] || 0,
        closed: closedByMonth[key] || 0,
        net: (closedByMonth[key] || 0) - (openedByMonth[key] || 0),
      });
    }

    res.json({ months: monthLabels });
  } catch (err) {
    console.error("Error fetching monthly cases:", err);
    res.status(500).json({ error: "Error fetching monthly cases" });
  }
});

// ─── GET /saved_reports/:id ──────────────────────────────────────────────────

router.get("/saved_reports/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [results] = await db.promise().query("SELECT * FROM saved_reports WHERE id = ?", [id]);

    if (!results.length) {
      return res.status(404).json({ error: "Report not found." });
    }

    const report = results[0];

    // Ownership check
    const requestingUid = getRequestingUid(req);
    if (requestingUid && report.uid && report.uid !== requestingUid) {
      return res.status(403).json({ error: "You do not have permission to view this report." });
    }

    report.filters = typeof report.filters === "string" ? JSON.parse(report.filters) : report.filters;
    report.custom_field_queries =
      typeof report.custom_field_queries === "string"
        ? JSON.parse(report.custom_field_queries)
        : report.custom_field_queries;
    report.selected_columns =
      typeof report.selected_columns === "string"
        ? JSON.parse(report.selected_columns)
        : report.selected_columns;

    res.status(200).json(report);
  } catch (err) {
    console.error("Error fetching saved report:", err);
    res.status(500).json({ error: "Error fetching saved report." });
  }
});

// ─── DELETE /saved_reports/:id ───────────────────────────────────────────────

router.delete("/saved_reports/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Ownership check
    const requestingUid = getRequestingUid(req);
    if (requestingUid) {
      const [rows] = await db.promise().query("SELECT uid FROM saved_reports WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ error: "Report not found." });
      if (rows[0].uid && rows[0].uid !== requestingUid) {
        return res.status(403).json({ error: "You do not have permission to delete this report." });
      }
    }

    const [result] = await db.promise().query("DELETE FROM saved_reports WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Report not found." });
    res.status(200).json({ message: "Report deleted successfully." });
  } catch (err) {
    console.error("Error deleting saved report:", err);
    res.status(500).json({ error: "Failed to delete report." });
  }
});

// GET /email_lists_by_practice_area
// Returns deduplicated emails grouped by practice area for:
// 1) current clients (open cases),
// 2) former clients (closed cases),
// 3) leads without retainer (no retainer-related case stage).
router.get("/email_lists_by_practice_area", (req, res) => {
  // Optional: override which case_stage text implies a retainer exists.
  const retainerStageKeyword = String(req.query.retainer_stage_keyword || "retainer").trim();

  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(c.practice_area), ''), '(Unspecified)') AS practice_area,
      TRIM(c.clients_email) AS email,
      COALESCE(c.case_stage, '') AS case_stage,
      COALESCE(c.closed_date, '') AS closed_date
    FROM cases c
    WHERE c.clients_email IS NOT NULL
      AND TRIM(c.clients_email) != ''
  `;

  db.query(query, (err, rows) => {
    if (err) {
      console.error("Error fetching email lists by practice area:", err);
      return res.status(500).json({ error: "Error fetching email lists by practice area" });
    }

    const grouped = {};
    const keyword = retainerStageKeyword.toLowerCase();

    const getBucket = (area) => {
      if (!grouped[area]) {
        grouped[area] = {
          current_clients: new Set(),
          former_clients: new Set(),
          leads_without_retainer: new Set()
        };
      }
      return grouped[area];
    };

    (rows || []).forEach((row) => {
      const practiceArea = row.practice_area || "(Unspecified)";
      const email = String(row.email || "").toLowerCase();
      if (!email) return;

      const caseStage = String(row.case_stage || "").toLowerCase();
      const closedDate = String(row.closed_date || "").trim();
      const isClosed = closedDate !== "";
      const hasRetainer = keyword ? caseStage.includes(keyword) : false;

      const bucket = getBucket(practiceArea);

      if (isClosed) {
        bucket.former_clients.add(email);
      } else {
        bucket.current_clients.add(email);
      }

      if (!hasRetainer) {
        bucket.leads_without_retainer.add(email);
      }
    });

    const byPracticeArea = Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .map((practice_area) => {
        const bucket = grouped[practice_area];
        const currentClients = Array.from(bucket.current_clients).sort();
        const formerClients = Array.from(bucket.former_clients).sort();
        const leadsWithoutRetainer = Array.from(bucket.leads_without_retainer).sort();

        return {
          practice_area,
          current_clients: currentClients,
          former_clients: formerClients,
          leads_without_retainer: leadsWithoutRetainer,
          counts: {
            current_clients: currentClients.length,
            former_clients: formerClients.length,
            leads_without_retainer: leadsWithoutRetainer.length
          }
        };
      });

    res.json({ byPracticeArea });
  });
});
module.exports = router;
