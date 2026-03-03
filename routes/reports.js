const express = require("express");
const router = express.Router();
const db = require("../db");
 
// POST /save_report – Save a new report
router.post("/save_report", (req, res) => {
  const { name, uid, filters, customFieldQueries, dateRange,selectedColumns  } = req.body;
 
  if (!name || !uid) {
    return res.status(400).send("Missing required fields: name or uid.");
  }
 
  const query = `
    INSERT INTO saved_reports (name, uid, filters, custom_field_queries, date_range,selected_columns)
    VALUES (?, ?, ?, ?, ?,?)
  `;
 
  const values = [
    name,
    uid,
    JSON.stringify(filters),
    JSON.stringify(customFieldQueries),
    dateRange || "",
    JSON.stringify(selectedColumns || [])
  ];
 
  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error saving report:", err);
      return res.status(500).send("Failed to save report.");
    }
 
    res.status(201).json({
      message: "Report saved successfully.",
      report_id: result.insertId,
    });
  });
});
// PUT /saved_reports/:id – Update report name
router.put("/saved_reports/:id", (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
 
    if (!name) return res.status(400).send("Report name is required.");
 
    const query = `UPDATE saved_reports SET name = ? WHERE id = ?`;
 
    db.query(query, [name, id], (err, result) => {
      if (err) {
        console.error("Error updating report name:", err);
        return res.status(500).send("Failed to update report name.");
      }
 
      if (!result.affectedRows) return res.status(404).send("Report not found.");
      res.status(200).json({ message: "Report name updated." });
    });
  });
 
// GET /saved_reports – List all reports by UID
router.get("/saved_reports", (req, res) => {
  const { uid } = req.query;
 
  if (!uid) return res.status(400).send("Missing uid.");
 
  const query = `
    SELECT id, name, date_range, created_at, filters, custom_field_queries, selected_columns
    FROM saved_reports
    WHERE uid = ?
    ORDER BY created_at DESC
  `;
 
  db.query(query, [uid], (err, results) => {
    if (err) {
      console.error("Error fetching saved reports:", err);
      return res.status(500).send("Failed to fetch reports.");
    }
 
    const parsedResults = results.map((report) => ({
      ...report,
      filters:
        typeof report.filters === "string"
          ? JSON.parse(report.filters)
          : report.filters,
      custom_field_queries:
        typeof report.custom_field_queries === "string"
          ? JSON.parse(report.custom_field_queries)
          : report.custom_field_queries,
      selected_columns:
        typeof report.selected_columns === "string"
          ? JSON.parse(report.selected_columns)
          : report.selected_columns,
    }));
 
    res.status(200).json(parsedResults);
  });
});
 
 router.get("/user_reports", (req, res) => {
  const { start_date, end_date, selected_user } = req.query;
 
  let conditions = [];
  let values = [];
 
  if (selected_user) {
    conditions.push("staff_id = ?");
    values.push(parseInt(selected_user, 10));
  }
 
  if (start_date) {
    conditions.push("DATE(entry_date) >= ?");
    values.push(start_date);
  }
 
  if (end_date) {
    conditions.push("DATE(entry_date) <= ?");
    values.push(end_date);
  }
 
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
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
    ${whereClause.replace(/staff_id/g, "te.staff_id")}
    ORDER BY te.entry_date DESC
    LIMIT ? OFFSET ?
  `;
 
  const expensesQuery = `
    SELECT
      e.expense_id, e.description, e.entry_date, e.billable, e.case_id,
      e.staff_id, e.activity_name, e.units, e.cost
    FROM expenses e
    ${whereClause.replace(/staff_id/g, "e.staff_id")}
    ORDER BY e.entry_date DESC
    LIMIT ? OFFSET ?
  `;
 
  const totalExpensesSumQuery = `
    SELECT SUM(cost * units) AS total_expenses
    FROM expenses e
    ${whereClause.replace(/staff_id/g, "e.staff_id")}
  `;
 
  const timeTotalsQuery = `
    SELECT
      SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) AS billable_hours,
      SUM(CASE WHEN billable = 0 THEN hours ELSE 0 END) AS non_billable_hours,
      SUM(CASE WHEN billable = 1 THEN flat_fee ELSE 0 END) AS billable_flat_fees,
      SUM(CASE WHEN billable = 1 THEN (rate * hours) ELSE 0 END) AS total_billable_amount
    FROM time_entries te
    ${whereClause.replace(/staff_id/g, "te.staff_id")}
  `;
 
  const expenseTotalsQuery = `
    SELECT
      SUM(CASE WHEN billable = 1 THEN (cost * units) ELSE 0 END) AS billable_expenses,
      SUM(CASE WHEN billable = 0 THEN (cost * units) ELSE 0 END) AS non_billable_expenses
    FROM expenses e
    ${whereClause.replace(/staff_id/g, "e.staff_id")}
  `;
 
  db.query(timeTotalsQuery, values, (err, timeTotalsResult) => {
    if (err) {
      console.error("Error fetching time totals:", err);
      return res.status(500).send("Error fetching time totals.");
    }
 
    db.query(expenseTotalsQuery, values, (err, expenseTotalsResult) => {
      if (err) {
        console.error("Error fetching expense totals:", err);
        return res.status(500).send("Error fetching expense totals.");
      }
 
      db.query(timeEntriesQuery, paginatedValues, (err, timeEntriesResults) => {
        if (err) {
          console.error("Error fetching time entries:", err);
          return res.status(500).send("Error fetching time entries.");
        }
 
        db.query(expensesQuery, paginatedValues, (err, expensesResults) => {
          if (err) {
            console.error("Error fetching expenses:", err);
            return res.status(500).send("Error fetching expenses.");
          }
 
          db.query(totalExpensesSumQuery, values, (err, totalExpensesResult) => {
            if (err) {
              console.error("Error fetching total expenses:", err);
              return res.status(500).send("Error fetching total expenses.");
            }
 
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
          });
        });
      });
    });
  });
});
 // Add this new endpoint to your backend routes
router.get("/employee_milestones", (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date are required" });
  }

  // Single optimized query using the correct table name and columns
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
        -- Only count if the case is still currently "PL Settled" (not changed to something else afterward)
        AND c.practice_area = 'PL Settled'
        -- Only count cases that have an assigned attorney
        AND (c.assigned_attorney_uid IS NOT NULL OR au_match.uid IS NOT NULL)
        -- Exclude specific attorneys from closure count (based on assigned attorney, not who made the change)
        AND COALESCE(
          (SELECT CONCAT(first_name, ' ', last_name) FROM active_users WHERE uid = c.assigned_attorney_uid),
          c.assigned_attorney
        ) NOT IN ('Pierre Louis', 'Melissa Romero', 'Magdaline Mintz')
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

  db.query(employeeMilestonesQuery, [start_date, end_date, start_date, end_date, start_date, end_date, start_date, end_date], (err, results) => {
    if (err) {
      console.error("Error fetching employee milestones:", err);
      return res.status(500).json({ error: "Error fetching employee milestones" });
    }

    // Separate attorneys and staff based on type and title
    const attorneys = results.filter(emp => 
      (emp.type && (
        emp.type.toLowerCase().includes('attorney') || 
        emp.type.toLowerCase().includes('lawyer') || 
        emp.type.toLowerCase().includes('partner')
      )) ||
      (emp.title && (
        emp.title.toLowerCase().includes('attorney') ||
        emp.title.toLowerCase().includes('lawyer') ||
        emp.title.toLowerCase().includes('partner')
      ))
    );
    
    const staff = results.filter(emp => 
      !(
        (emp.type && (
          emp.type.toLowerCase().includes('attorney') || 
          emp.type.toLowerCase().includes('lawyer') || 
          emp.type.toLowerCase().includes('partner')
        )) ||
        (emp.title && (
          emp.title.toLowerCase().includes('attorney') ||
          emp.title.toLowerCase().includes('lawyer') ||
          emp.title.toLowerCase().includes('partner')
        ))
      )
    );

    res.json({
      attorneys: attorneys.map(emp => ({
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
        closureCount: parseInt(emp.closure_count || 0)
      })),
      staff: staff.map(emp => ({
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
        closureCount: parseInt(emp.closure_count || 0)
      }))
    });
  });
});

// GET /employee_closure_cases - fetch closure cases for a specific employee
router.get("/employee_closure_cases", (req, res) => {
  const {
    staff_id,
    start_date,
    end_date,
    page = 1,
    limit = 20,
    sort_by = "date", // date, case_name
    sort_order = "desc" // asc, desc
  } = req.query;

  if (!staff_id) {
    return res.status(400).json({ error: "Staff ID is required" });
  }

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  // Get the employee's uid to match closure cases
  const getEmployeeUidQuery = `
    SELECT uid FROM active_users WHERE staff_id = ? LIMIT 1
  `;

  db.query(getEmployeeUidQuery, [staff_id], (err, uidResults) => {
    if (err) {
      console.error("Error fetching employee uid:", err);
      return res.status(500).json({ error: "Error fetching employee information" });
    }

    if (!uidResults.length || !uidResults[0].uid) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const employeeUid = uidResults[0].uid;

    let conditions = [];
    let values = [];

    // Base condition: cases that were closed (practice_area changed to 'PL Settled') by this attorney
    conditions.push(`
      (
        c.assigned_attorney_uid = ? OR 
        (c.assigned_attorney IS NOT NULL AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name) AND au_match.uid = ?)
      )
    `);
    values.push(employeeUid, employeeUid);

    // Only cases that are currently 'PL Settled'
    conditions.push("c.practice_area = 'PL Settled'");

    // Exclude specific attorneys
    conditions.push(`
      COALESCE(
        (SELECT CONCAT(first_name, ' ', last_name) FROM active_users WHERE uid = c.assigned_attorney_uid),
        c.assigned_attorney
      ) NOT IN ('Pierre Louis', 'Melissa Romero', 'Magdaline Mintz')
    `);

    // Date range filter on when the case was closed (timestamp in case_activity_logs)
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

    // Determine sort column and order
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

    // Summary query for ALL records (not just current page)
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
    const countValues = values;

    db.query(casesQuery, queryValues, (err, casesResults) => {
      if (err) {
        console.error("Error fetching closure cases:", err);
        return res.status(500).json({ error: "Error fetching closure cases" });
      }

      db.query(countQuery, countValues, (err, countResults) => {
        if (err) {
          console.error("Error fetching total count:", err);
          return res.status(500).json({ error: "Error fetching total count" });
        }

        db.query(summaryQuery, countValues, (err, summaryResults) => {
          if (err) {
            console.error("Error fetching summary:", err);
            return res.status(500).json({ error: "Error fetching summary" });
          }

          res.json({
            cases: casesResults,
            pagination: {
              totalRecords: countResults[0].total,
              totalPages: Math.ceil(countResults[0].total / limitNumber),
              currentPage: pageNumber,
              recordsPerPage: limitNumber,
              hasMore: pageNumber < Math.ceil(countResults[0].total / limitNumber)
            },
            summary: {
              total_cases: summaryResults[0]?.total_cases || 0,
              earliest_closure_date: summaryResults[0]?.earliest_closure_date,
              latest_closure_date: summaryResults[0]?.latest_closure_date
            }
          });
        });
      });
    });
  });
});
// GET /employee_new_client_cases - fetch new client cases (opened in date range) for a specific employee
router.get("/employee_new_client_cases", (req, res) => {
  const {
    staff_id,
    start_date,
    end_date,
    page = 1,
    limit = 20,
    sort_by = "date",
    sort_order = "desc"
  } = req.query;

  if (!staff_id) {
    return res.status(400).json({ error: "Staff ID is required" });
  }

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  const getEmployeeUidQuery = `
    SELECT uid FROM active_users WHERE staff_id = ? LIMIT 1
  `;

  db.query(getEmployeeUidQuery, [staff_id], (err, uidResults) => {
    if (err) {
      console.error("Error fetching employee uid:", err);
      return res.status(500).json({ error: "Error fetching employee information" });
    }

    if (!uidResults.length || !uidResults[0].uid) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const employeeUid = uidResults[0].uid;

    const conditions = [
      `(
        c.assigned_attorney_uid = ? OR 
        (c.assigned_attorney IS NOT NULL AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name) AND au_match.uid = ?)
      )`,
      `DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) IS NOT NULL`
    ];
    const values = [employeeUid, employeeUid];

    if (start_date && end_date) {
      conditions.push(`DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) BETWEEN ? AND ?`);
      values.push(start_date, end_date);
    } else if (start_date) {
      conditions.push(`DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) >= ?`);
      values.push(start_date);
    } else if (end_date) {
      conditions.push(`DATE(COALESCE(STR_TO_DATE(c.opened_date, '%Y-%m-%d'), STR_TO_DATE(c.opened_date, '%m/%d/%y'))) <= ?`);
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

    const summaryQuery = `
      SELECT
        COUNT(DISTINCT c.case_id) as total_cases
      FROM cases c
      LEFT JOIN active_users au_match ON (
        c.assigned_attorney IS NOT NULL 
        AND c.assigned_attorney = CONCAT(au_match.first_name, ' ', au_match.last_name)
      )
      ${whereClause}
    `;

    const queryValues = [...values, limitNumber, offset];
    const countValues = values;

    db.query(casesQuery, queryValues, (err, casesResults) => {
      if (err) {
        console.error("Error fetching new client cases:", err);
        return res.status(500).json({ error: "Error fetching new client cases" });
      }

      db.query(countQuery, countValues, (err, countResults) => {
        if (err) {
          console.error("Error fetching total count:", err);
          return res.status(500).json({ error: "Error fetching total count" });
        }

        db.query(summaryQuery, countValues, (err, summaryResults) => {
          if (err) {
            console.error("Error fetching summary:", err);
            return res.status(500).json({ error: "Error fetching summary" });
          }

          res.json({
            cases: casesResults,
            pagination: {
              totalRecords: countResults[0].total,
              totalPages: Math.ceil(countResults[0].total / limitNumber),
              currentPage: pageNumber,
              recordsPerPage: limitNumber,
              hasMore: pageNumber < Math.ceil(countResults[0].total / limitNumber)
            },
            summary: {
              total_cases: summaryResults[0]?.total_cases || 0
            }
          });
        });
      });
    });
  });
});

// GET /new_client_by_practice_area - count of new cases (created_at in date range) grouped by practice area
// status: 'open' | 'closed' | 'both' (default 'open'). Uses created_at for "when case was created".
router.get("/new_client_by_practice_area", (req, res) => {
  const { start_date, end_date, status = "open" } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date are required" });
  }

  const conditions = [
    "c.created_at IS NOT NULL",
    "DATE(c.created_at) BETWEEN ? AND ?"
  ];
  const values = [start_date, end_date];

  if (status === "open") {
    conditions.push("(COALESCE(c.closed_date, '') = '')");
  } else if (status === "closed") {
    conditions.push("(COALESCE(c.closed_date, '') != '')");
  }
  // 'both' = no extra condition

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

  db.query(query, values, (err, results) => {
    if (err) {
      console.error("Error fetching new client by practice area:", err);
      return res.status(500).json({ error: "Error fetching new client by practice area" });
    }
    res.json({
      byPracticeArea: results.map((row) => ({
        practice_area: row.practice_area,
        count: parseInt(row.count || 0, 10)
      }))
    });
  });
});

// GET /new_client_cases_by_practice_area - list cases with created_at in date range for a practice area
// status: 'open' | 'closed' | 'both' (default 'open'). Uses created_at for "when case was created".
router.get("/new_client_cases_by_practice_area", (req, res) => {
  const {
    practice_area,
    start_date,
    end_date,
    status = "open",
    page = 1,
    limit = 20,
    sort_by = "date",
    sort_order = "desc"
  } = req.query;

  if (!practice_area) {
    return res.status(400).json({ error: "practice_area is required" });
  }

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  const conditions = [
    `COALESCE(NULLIF(TRIM(c.practice_area), ''), '(Unspecified)') = ?`,
    `c.created_at IS NOT NULL`
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

  const summaryQuery = `
    SELECT COUNT(DISTINCT c.case_id) as total_cases
    FROM cases c
    ${whereClause}
  `;

  const queryValues = [...values, limitNumber, offset];
  const countValues = values;

  db.query(casesQuery, queryValues, (err, casesResults) => {
    if (err) {
      console.error("Error fetching new client cases by practice area:", err);
      return res.status(500).json({ error: "Error fetching new client cases" });
    }

    db.query(countQuery, countValues, (err, countResults) => {
      if (err) {
        console.error("Error fetching total count:", err);
        return res.status(500).json({ error: "Error fetching total count" });
      }

      db.query(summaryQuery, countValues, (err, summaryResults) => {
        if (err) {
          console.error("Error fetching summary:", err);
          return res.status(500).json({ error: "Error fetching summary" });
        }

        res.json({
          cases: casesResults,
          pagination: {
            totalRecords: countResults[0].total,
            totalPages: Math.ceil(countResults[0].total / limitNumber),
            currentPage: pageNumber,
            recordsPerPage: limitNumber,
            hasMore: pageNumber < Math.ceil(countResults[0].total / limitNumber)
          },
          summary: {
            total_cases: summaryResults[0]?.total_cases || 0
          }
        });
      });
    });
  });
});

// GET /monthly_cases_opened_closed - last N months: opened count (created_at) and closed count (PL Settled in month) per month
// Used for line chart: upward trend = more closed than opened, downward = more opened than closed
router.get("/monthly_cases_opened_closed", (req, res) => {
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

  db.query(openedQuery, [months], (err, openedRows) => {
    if (err) {
      console.error("Error fetching monthly opened:", err);
      return res.status(500).json({ error: "Error fetching monthly opened counts" });
    }

    db.query(closedQuery, [months], (err, closedRows) => {
      if (err) {
        console.error("Error fetching monthly closed:", err);
        return res.status(500).json({ error: "Error fetching monthly closed counts" });
      }

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
          net: (closedByMonth[key] || 0) - (openedByMonth[key] || 0)
        });
      }

      res.json({ months: monthLabels });
    });
  });
});
// GET /saved_reports/:id – Fetch a specific saved report
router.get("/saved_reports/:id", (req, res) => {
    const { id } = req.params;
 
    db.query("SELECT * FROM saved_reports WHERE id = ?", [id], (err, results) => {
      if (err) {
        console.error("Error fetching saved report:", err);
        return res.status(500).send("Error fetching saved report.");
      }
 
      if (!results.length) {
        return res.status(404).send("Report not found.");
      }
 
      const report = results[0];
 
      // ✅ Safely parse JSON strings
      try {
        report.filters = typeof report.filters === "string" ? JSON.parse(report.filters) : report.filters;
        report.custom_field_queries = typeof report.custom_field_queries === "string"
          ? JSON.parse(report.custom_field_queries)
          : report.custom_field_queries;
 
        res.status(200).json(report);
      } catch (parseErr) {
        console.error("Failed to parse saved report JSON:", parseErr);
        return res.status(500).send("Error parsing report data.");
      }
    });
  });
 
 
// DELETE /saved_reports/:id – Delete a saved report
router.delete("/saved_reports/:id", (req, res) => {
  const { id } = req.params;
 
  db.query("DELETE FROM saved_reports WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Error deleting saved report:", err);
      return res.status(500).send("Failed to delete report.");
    }
 
    if (!result.affectedRows) return res.status(404).send("Report not found.");
 
    res.status(200).json({ message: "Report deleted successfully." });
  });
});


module.exports = router;