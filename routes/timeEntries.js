// routes/timeEntries.js
const express = require("express");
const router = express.Router();
const db = require("../db");
 
// GET /time_entries – fetch time entries with filters and pagination
router.get("/time_entries", (req, res) => {
  const {
    case_id,
    range,
    start_date,
    end_date,
    billable,
    staff_id,
    user_id ,
    page = 1,
    limit = 20,
  } = req.query;
 
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;
 
  let conditions = [];
  let values = [];
  if (user_id) {
  conditions.push("te.staff_id = (SELECT staff_id FROM active_users WHERE uid = ? LIMIT 1)");
  values.push(user_id);
}
  // if (user_id) {
  //   conditions.push("te.uid = ?");
  //   values.push(user_id);
  // }
  if (case_id) {
    conditions.push("te.case_id = ?");
    values.push(case_id);
  }
// In your API route
// if (uid) {
//   conditions.push("te.uid = ?");
//   values.push(uid);
// }
  if (range === "last_7_days") {
    conditions.push("te.entry_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
  } else if (range === "last_30_days") {
    conditions.push("te.entry_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
  } else if (range === "last_90_days") {
    conditions.push("te.entry_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)");
  } else if (range === "last_year") {
    conditions.push(
      "YEAR(te.entry_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 YEAR))"
    );
  } else if (range === "month_to_date") {
    conditions.push("te.entry_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
  } else if (range === "year_to_date") {
    conditions.push("te.entry_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')");
  } else if (start_date && end_date) {
    conditions.push("te.entry_date BETWEEN ? AND ?");
    values.push(start_date, end_date);
  } else if (range && /^\d{4}-\d{2}-\d{2}$/.test(range)) {
    // NEW: If range is a date (YYYY-MM-DD), filter by exact date
    conditions.push("DATE(te.entry_date) = ?");
    values.push(range);
  }
  // Apply billable filter
  if (billable === "1") {
    conditions.push("te.billable = 1");
  } else if (billable === "0") {
    conditions.push("te.billable = 0");
  }
 
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
  const entriesQuery = `
    SELECT
        te.time_entry_id, te.description, te.entry_date, te.billable, te.case_id,
        te.staff_id, te.activity_name, te.created_at, te.updated_at, te.rate,
        te.flat_fee, te.hours,te.updated_by_uid,te.company_time_batch_id, c.name AS case_name,
        CONCAT(au.first_name, ' ', au.last_name) AS active_user_staff_name,
        CONCAT(s.first_name, ' ', s.last_name) AS staff_table_staff_name
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN active_users au ON te.staff_id = au.staff_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${whereClause}
ORDER BY te.entry_date DESC, te.created_at DESC
    LIMIT ? OFFSET ?
`;
 
  values.push(limitNumber, offset);
 
  const countQuery = `SELECT COUNT(*) as total FROM time_entries te ${whereClause}`;
 
  // --- Updated Query for Total Rates Summary ---
  const rateSummaryQuery = `
  SELECT
    SUM(CASE WHEN te.billable = 1 THEN te.rate ELSE 0 END) AS total_billable_rate,
    SUM(CASE WHEN te.billable = 0 THEN te.rate ELSE 0 END) AS total_non_billable_rate,
    SUM(te.rate * te.hours) AS total_rate_hours,
    SUM(CASE WHEN te.billable = 1 THEN te.rate * te.hours ELSE 0 END) AS billable_rate_hours,
    SUM(CASE WHEN te.billable = 0 THEN te.rate * te.hours ELSE 0 END) AS non_billable_rate_hours,
    SUM(te.rate * te.hours) AS total_combined_rate_hours
  FROM time_entries te
  ${whereClause}
`;
 
 
  db.query(entriesQuery, values, (err, entriesResults) => {
    if (err) {
      console.error("Error fetching time entries:", err);
      return res.status(500).send("Error fetching time entries.");
    }
 
    db.query(countQuery, values.slice(0, -2), (err, countResults) => {
      if (err) {
        console.error("Error fetching total count:", err);
        return res.status(500).send("Error fetching total count.");
      }
 
      db.query(
        rateSummaryQuery,
        values.slice(0, -2),
        (err, rateSummaryResults) => {
          if (err) {
            console.error("Error fetching rate summary:", err);
            return res.status(500).send("Error fetching rate summary.");
          }
 
          res.json({
            data: entriesResults,
            pagination: {
              totalRecords: countResults[0].total,
              totalPages: Math.ceil(countResults[0].total / limitNumber),
              currentPage: pageNumber,
              recordsPerPage: limitNumber,
            },
            rateSummary: {
              billable_rate: rateSummaryResults[0]?.total_billable_rate || 0,
              non_billable_rate: rateSummaryResults[0]?.total_non_billable_rate || 0,
              total_rate_hours: rateSummaryResults[0]?.total_rate_hours || 0,
              billable_rate_hours: rateSummaryResults[0]?.billable_rate_hours || 0,
              non_billable_rate_hours: rateSummaryResults[0]?.non_billable_rate_hours || 0,
              total_combined_rate_hours: rateSummaryResults[0]?.total_combined_rate_hours || 0,
            },
           
          });
        }
      );
    });
  });
});
router.get("/time_entries/search", (req, res) => {
  const {
    case_id,
    search,
    page = 1,
    limit = 20,
  } = req.query;
 
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;
 
  let conditions = [];
  let values = [];
 
  if (case_id) {
    conditions.push("te.case_id = ?");
    values.push(case_id);
  }
 
  if (search) {
    conditions.push(`
      (te.description LIKE ? OR
      te.activity_name LIKE ? OR
      c.name LIKE ? OR
      CONCAT(au.first_name, ' ', au.last_name) LIKE ? OR
      CONCAT(s.first_name, ' ', s.last_name) LIKE ?)
    `);
    const searchTerm = `%${search}%`;
    values.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }
 
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
  // Simplified query with just the data fetch
  const entriesQuery = `
    SELECT
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
            te.company_time_batch_id,

      c.name AS case_name,
      COALESCE(CONCAT(au.first_name, ' ', au.last_name), CONCAT(s.first_name, ' ', s.last_name)) AS staff_name
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN active_users au ON te.staff_id = au.staff_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${whereClause}
    ORDER BY te.entry_date DESC, te.created_at DESC
    LIMIT ? OFFSET ?
  `;
 
  db.query(entriesQuery, [...values, limitNumber, offset], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Error fetching time entries");
    }
   
    res.json({
      data: results,
      pagination: {
        currentPage: pageNumber,
        recordsPerPage: limitNumber
      }
    });
  });
});
// GET /time_entries/:id – fetch single time entry
router.get("/time_entries/:id", (req, res) => {
  const query = "SELECT * FROM time_entries WHERE time_entry_id = ?";
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error("Error fetching time entry:", err);
      return res.status(500).send("Error fetching time entry.");
    }
    if (results.length === 0) {
      return res.status(404).send("Time entry not found.");
    }
    res.json(results[0]);
  });
});
 
// POST /time_entries – create new time entry
router.post("/time_entries", (req, res) => {
  const {
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    rate,
    flat_fee,
    hours,
    uid,
    company_time_batch_id,
  } = req.body;
 
  if (
    !description ||
    !entry_date ||
    !case_id ||
    !activity_name ||
    !rate ||
    !hours
  ) {
    return res.status(400).send("Missing required fields.");
  }
 
  const query = `
    INSERT INTO time_entries (description, entry_date, billable, case_id, staff_id, activity_name,
                              created_at, updated_at, rate, flat_fee, hours, uid,company_time_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), ?, ?, ?, ?,?)
  `;
 
  const values = [
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    rate,
    flat_fee,
    hours,
    uid,
        company_time_batch_id || null,

  ];
 
  db.query(query, values, async(err, result) => {
    if (err) {
      console.error("Error adding time entry:", err);
      return res.status(500).send("Error adding time entry.");
    }
await db.promise().query(
  "INSERT INTO time_entry_logs (time_entry_id, action, case_id, uid, timestamp) VALUES (?, 'create', ?, ?, CONVERT_TZ(NOW(), 'UTC', 'America/New_York'))",
  [result.insertId, case_id, uid]
);
 
   
 
    res.status(201).json({
      message: "Time entry created successfully",
      time_entry_id: result.insertId,
    });
  });
});
 
// PUT /time_entries/:id – update time entry
router.put("/time_entries/:id", async (req, res) => {
  const {
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    rate,
    flat_fee,
    hours,
  } = req.body;
 
  const query = `
    UPDATE time_entries
    SET description = ?, entry_date = ?, billable = ?, case_id = ?, staff_id = ?, activity_name = ?,
        updated_at = CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), rate = ?, flat_fee = ?, hours = ?, updated_by_uid = ?
    WHERE time_entry_id = ?
  `;
  const userUid = req.headers["x-user-uid"] || req.body.uid;
  if (!userUid)
    return res.status(401).json({ error: "User UID missing in request" });
  const values = [
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    rate,
    flat_fee,
    hours,
    userUid,
    req.params.id,
  ];
 
  try {
    const [existingEntries] = await db
      .promise()
      .query("SELECT * FROM time_entries WHERE time_entry_id = ?", [
        req.params.id,
      ]);
    if (existingEntries.length === 0)
      return res.status(404).send("Time entry not found.");
    const existingEntry = existingEntries[0];
 
    await db.promise().query(query, values);
 
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
    });
    const userUid = req.headers["x-user-uid"] || req.body.uid;
    if (!userUid)
      return res.status(401).json({ error: "User UID missing in request" });
 
    for (const key of Object.keys(req.body)) {
      if (key === "uid") continue; // Skip logging uid
 
      let oldValue = existingEntry[key];
      let newValue = req.body[key];
 
      // Normalize date values for comparison
      if (key === "entry_date") {
        try {
          oldValue = new Date(oldValue).toISOString().split("T")[0]; // YYYY-MM-DD
          newValue = new Date(newValue).toISOString().split("T")[0];
        } catch (e) {
          console.warn(
            "Date normalization failed for entry_date comparison:",
            e
          );
        }
      }
 
      if (oldValue != newValue && !(oldValue == null && newValue === "")) {
        await db.promise().query(
          `INSERT INTO time_entry_logs (uid, time_entry_id, action, case_id, timestamp, field_name, old_value, new_value)
           VALUES (?, ?, 'update', ?, CONVERT_TZ(NOW(), 'UTC', 'America/New_York'), ?, ?, ?)`,
          [
            userUid,
            req.params.id,
            existingEntry.case_id,
            key,
            `${oldValue}`,
            `${newValue}`,
          ]
        );
      }
    }
 
    res.json({ message: "Time entry updated successfully" });
  } catch (err) {
    console.error("Error updating time entry:", err);
    res.status(500).send("Error updating time entry.");
  }
});
 
// GET /time_entries/recent-activity – fetch recent time entry activity logs
 
 
// DELETE /time_entries/:id – delete a time entry
router.delete("/time_entries/:id", (req, res) => {
  const query = "DELETE FROM time_entries WHERE time_entry_id = ?";
 
  db.query(query, [req.params.id], (err, result) => {
    if (err) {
      console.error("Error deleting time entry:", err);
      return res.status(500).send("Error deleting time entry.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Time entry not found.");
    }
    res.json({ message: "Time entry deleted successfully" });
  });
});


router.get("/today_hours", (req, res) => {
  const { user_id } = req.query; // still receiving uid

  if (!user_id) {
    return res.status(400).json({ error: "User ID is required" });
  }

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  // First, get staff_id for this uid
  const getStaffIdQuery = `SELECT staff_id FROM active_users WHERE uid = ? LIMIT 1`;

  db.query(getStaffIdQuery, [user_id], (err, results) => {
    if (err) {
      console.error("Error fetching staff ID:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results.length) {
      return res.status(404).json({ error: "Staff not found" });
    }

    const staffId = results[0].staff_id;

    // Then, get today's hours for this staff_id
    const timeQuery = `
      SELECT COALESCE(SUM(hours), 0) as total_hours
      FROM time_entries
      WHERE staff_id = ? AND DATE(entry_date) = ?
    `;

    db.query(timeQuery, [staffId, today], (err2, timeResults) => {
      if (err2) {
        console.error("Error fetching today's hours:", err2);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({ totalHours: parseFloat(timeResults[0]?.total_hours) || 0 });
    });
  });
});

// GET /employee_billable_details - fetch detailed billable entries for a specific employee
router.get("/employee_billable_details", (req, res) => {
  const {
    staff_id,
    start_date,
    end_date,
    page = 1,
    limit = 20,
    sort_by = "date", // date, amount, hours
    sort_order = "desc" // asc, desc
  } = req.query;
 
  if (!staff_id) {
    return res.status(400).json({ error: "Staff ID is required" });
  }
 
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;
 
  let conditions = ["te.billable = 1"]; // Only billable entries
  let values = [];
 
  // Add staff_id condition
  conditions.push("te.staff_id = ?");
  values.push(staff_id);
 
  // Add date range conditions
  if (start_date && end_date) {
    conditions.push("te.entry_date BETWEEN ? AND ?");
    values.push(start_date, end_date);
  } else if (start_date) {
    conditions.push("te.entry_date >= ?");
    values.push(start_date);
  } else if (end_date) {
    conditions.push("te.entry_date <= ?");
    values.push(end_date);
  }
 
  const whereClause = `WHERE ${conditions.join(" AND ")}`;
 
  // Determine sort column and order
  let orderBy = "te.entry_date DESC, te.created_at DESC";
  switch (sort_by) {
    case "amount":
      orderBy = sort_order === "asc" ? "te.rate * te.hours ASC" : "te.rate * te.hours DESC";
      break;
    case "hours":
      orderBy = sort_order === "asc" ? "te.hours ASC" : "te.hours DESC";
      break;
    case "date":
    default:
      orderBy = sort_order === "asc" ? "te.entry_date ASC, te.created_at ASC" : "te.entry_date DESC, te.created_at DESC";
      break;
  }
 
  const entriesQuery = `
    SELECT
      te.time_entry_id as id,
      te.entry_date as date,
      te.description,
      te.hours,
      te.rate,
      (te.rate * te.hours) as amount,
      te.activity_name,
      te.flat_fee,
      te.created_at,
      te.updated_at,
      te.billable,
      c.name as case_name,
      c.case_number,
      c.case_id,
      CONCAT(COALESCE(au.first_name, s.first_name), ' ', COALESCE(au.last_name, s.last_name)) as staff_name,
      te.staff_id,
      te.uid,
      te.updated_by_uid,
      -- Calculate start and end times
      TIME_FORMAT(SEC_TO_TIME(te.hours * 3600), '%H:%i') as start_time,
      TIME_FORMAT(SEC_TO_TIME(te.hours * 3600), '%H:%i') as end_time,
      -- Status based on whether it's been billed
      CASE
        WHEN te.billable = 1 THEN 'billed'
        ELSE 'pending'
      END as status
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN active_users au ON te.staff_id = au.staff_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
 
  values.push(limitNumber, offset);
 
  const countQuery = `
    SELECT COUNT(*) as total
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN active_users au ON te.staff_id = au.staff_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${whereClause}
  `;
 
  // Summary query for ALL records (not just current page)
  const summaryQuery = `
    SELECT
      COUNT(*) as total_entries,
      SUM(te.hours) as total_hours,
      SUM(te.rate * te.hours) as total_amount,
      AVG(te.rate) as average_rate,
      MIN(te.entry_date) as earliest_date,
      MAX(te.entry_date) as latest_date
    FROM time_entries te
    LEFT JOIN cases c ON te.case_id = c.case_id
    LEFT JOIN active_users au ON te.staff_id = au.staff_id
    LEFT JOIN staff s ON te.staff_id = s.staff_id
    ${whereClause}
  `;
 
  db.query(entriesQuery, values, (err, entriesResults) => {
    if (err) {
      console.error("Error fetching billable entries:", err);
      return res.status(500).json({ error: "Error fetching billable entries" });
    }
 
    db.query(countQuery, values.slice(0, -2), (err, countResults) => {
      if (err) {
        console.error("Error fetching total count:", err);
        return res.status(500).json({ error: "Error fetching total count" });
      }
 
      db.query(summaryQuery, values.slice(0, -2), (err, summaryResults) => {
        if (err) {
          console.error("Error fetching summary:", err);
          return res.status(500).json({ error: "Error fetching summary" });
        }
 
        res.json({
          entries: entriesResults,
          pagination: {
            totalRecords: countResults[0].total,
            totalPages: Math.ceil(countResults[0].total / limitNumber),
            currentPage: pageNumber,
            recordsPerPage: limitNumber,
            hasMore: pageNumber < Math.ceil(countResults[0].total / limitNumber)
          },
          summary: {
            total_entries: summaryResults[0]?.total_entries || 0,
            total_hours: parseFloat(summaryResults[0]?.total_hours) || 0,
            total_amount: parseFloat(summaryResults[0]?.total_amount) || 0,
            average_rate: parseFloat(summaryResults[0]?.average_rate) || 0,
            earliest_date: summaryResults[0]?.earliest_date,
            latest_date: summaryResults[0]?.latest_date
          }
        });
      });
    });
  });
});
 
module.exports = router;