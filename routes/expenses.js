// routes/expenses.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /expenses – fetch expenses with filters and pagination
router.get("/expenses", (req, res) => {
  const {
    case_id,
    range,
    start_date,
    end_date,
    page = 1,
    limit = 20,
  } = req.query;

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  let conditions = [];
  let values = [];

  if (case_id) {
    conditions.push("case_id = ?");
    values.push(case_id);
  }

  if (range === "last_7_days") {
    conditions.push("entry_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
  } else if (range === "last_30_days") {
    conditions.push("entry_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
  } else if (range === "last_90_days") {
    conditions.push("entry_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)");
  } else if (range === "last_year") {
    conditions.push(
      "YEAR(entry_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 YEAR))"
    );
  } else if (range === "month_to_date") {
    conditions.push("entry_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
  } else if (range === "year_to_date") {
    conditions.push("entry_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')");
  } else if (start_date && end_date) {
    conditions.push("entry_date BETWEEN ? AND ?");
    values.push(start_date, end_date);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const entriesQuery = `
    SELECT expense_id, description, entry_date, billable, case_id, staff_id, activity_name, 
           created_at, updated_at, units, cost
    FROM expenses
    ${whereClause}
ORDER BY entry_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `;
  values.push(limitNumber, offset);

  const countQuery = `SELECT COUNT(*) as total FROM expenses ${whereClause}`;

  const costSummaryQuery = `
    SELECT 
      SUM(CASE WHEN billable = 1 THEN cost ELSE 0 END) AS total_billable_cost,
      SUM(CASE WHEN billable = 0 THEN cost ELSE 0 END) AS total_non_billable_cost,
      SUM(cost * units) AS total_cost_units
    FROM expenses
    ${whereClause}
  `;

  db.query(entriesQuery, values, (err, entriesResults) => {
    if (err) {
      console.error("Error fetching expenses:", err);
      return res.status(500).send("Error fetching expenses.");
    }

    db.query(countQuery, values.slice(0, -2), (err, countResults) => {
      if (err) {
        console.error("Error fetching total count:", err);
        return res.status(500).send("Error fetching total count.");
      }

      db.query(
        costSummaryQuery,
        values.slice(0, -2),
        (err, costSummaryResults) => {
          if (err) {
            console.error("Error fetching cost summary:", err);
            return res.status(500).send("Error fetching cost summary.");
          }

          res.json({
            data: entriesResults,
            pagination: {
              totalRecords: countResults[0].total,
              totalPages: Math.ceil(countResults[0].total / limitNumber),
              currentPage: pageNumber,
              recordsPerPage: limitNumber,
            },
            costSummary: {
              billable_cost: costSummaryResults[0]?.total_billable_cost || 0,
              non_billable_cost:
                costSummaryResults[0]?.total_non_billable_cost || 0,
              total_cost_units: costSummaryResults[0]?.total_cost_units || 0,
            },
          });
        }
      );
    });
  });
});

// GET /expenses/:id – fetch a single expense by ID
router.get("/expenses/:id", (req, res) => {
  const query = "SELECT * FROM expenses WHERE expense_id = ?";
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error("Error fetching expense:", err);
      return res.status(500).send("Error fetching expense.");
    }
    if (results.length === 0) {
      return res.status(404).send("Expense not found.");
    }
    res.json(results[0]);
  });
});

// POST /expenses – create a new expense
router.post("/expenses", (req, res) => {
  const {
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    units,
    cost,
  } = req.body;

  if (
    !description ||
    !entry_date ||
    !case_id ||
    !activity_name ||
    units === undefined ||
    cost === undefined
  ) {
    return res.status(400).send("Missing required fields.");
  }

  const query = `
    INSERT INTO expenses (description, entry_date, billable, case_id, staff_id, activity_name, 
                          created_at, updated_at, units, cost) 
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
  `;

  const values = [
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    units,
    cost,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error adding expense:", err);
      return res.status(500).send("Error adding expense.");
    }
    res.status(201).json({
      message: "Expense created successfully",
      expense_id: result.insertId,
    });
  });
});

// PUT /expenses/:id – update an expense
router.put("/expenses/:id", (req, res) => {
  const {
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    units,
    cost,
  } = req.body;

  const query = `
    UPDATE expenses 
    SET description = ?, entry_date = ?, billable = ?, case_id = ?, staff_id = ?, activity_name = ?, 
        updated_at = NOW(), units = ?, cost = ?
    WHERE expense_id = ?
  `;

  const values = [
    description,
    entry_date,
    billable,
    case_id,
    staff_id,
    activity_name,
    units,
    cost,
    req.params.id,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error updating expense:", err);
      return res.status(500).send("Error updating expense.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Expense not found.");
    }
    res.json({ message: "Expense updated successfully" });
  });
});

// DELETE /expenses/:id – delete an expense
router.delete("/expenses/:id", (req, res) => {
  const query = "DELETE FROM expenses WHERE expense_id = ?";

  db.query(query, [req.params.id], (err, result) => {
    if (err) {
      console.error("Error deleting expense:", err);
      return res.status(500).send("Error deleting expense.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Expense not found.");
    }
    res.json({ message: "Expense deleted successfully" });
  });
});

module.exports = router;