// routes/caseStages.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET all case stages
router.get("/case_stages", (req, res) => {
  const query = "SELECT * FROM case_stage ORDER BY stage_order ASC";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching case stages:", err);
      return res.status(500).send("Error fetching case stages.");
    }
    res.json(results);
  });
});

// GET a single case stage by ID
router.get("/case_stages/:id", (req, res) => {
  const id = req.params.id;
  const query = "SELECT * FROM case_stage WHERE case_stage_id = ?";
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching case stage:", err);
      return res.status(500).send("Error fetching case stage.");
    }
    if (results.length === 0) {
      return res.status(404).send("Case stage not found.");
    }
    res.json(results[0]);
  });
});

// POST - Create a new case stage
router.post("/case_stages", (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).send("Name is required.");
  }
  const query =
    "INSERT INTO case_stage (case_stage_name, created_at, updated_at) VALUES (?, NOW(), NOW())";
  db.query(query, [name], (err, result) => {
    if (err) {
      console.error("Error adding case stage:", err);
      return res.status(500).send("Error adding case stage.");
    }
    res.status(201).json({ id: result.insertId, name });
  });
});

// PUT - Update case stages (batch update)
router.put("/case_stages", (req, res) => {
  const stages = req.body;
  if (!Array.isArray(stages) || stages.length === 0) {
    return res.status(400).send("Payload should be a non-empty array.");
  }

  let errors = [];
  let completed = 0;

  stages.forEach((stage) => {
    const { case_stage_id, case_stage_name, stage_order } = stage;
    if (!case_stage_id || !case_stage_name) {
      errors.push(`Missing case_stage_id or case_stage_name for stage: ${JSON.stringify(stage)}`);
      completed++;
      if (completed === stages.length) finalize();
      return;
    }

    const query =
      "UPDATE case_stage SET case_stage_name = ?, stage_order = ?, updated_at = NOW() WHERE case_stage_id = ?";
    db.query(query, [case_stage_name, stage_order, case_stage_id], (err, result) => {
      if (err) {
        errors.push(`Error updating stage ${case_stage_id}: ${err.message}`);
      } else if (result.affectedRows === 0) {
        errors.push(`Case stage not found: ${case_stage_id}`);
      }
      completed++;
      if (completed === stages.length) finalize();
    });
  });

  function finalize() {
    if (errors.length > 0) {
      return res.status(500).send(errors.join("\n"));
    }
    const selectQuery = "SELECT * FROM case_stage ORDER BY stage_order ASC";
    db.query(selectQuery, (err, allStages) => {
      if (err) {
        return res.status(500).send("Error fetching case stages.");
      }
      res.json(allStages);
    });
  }
});

// DELETE - Delete a case stage
router.delete("/case_stages/:id", (req, res) => {
  const id = req.params.id;
  const query = "DELETE FROM case_stage WHERE case_stage_id = ?";
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting case stage:", err);
      return res.status(500).send("Error deleting case stage.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Case stage not found.");
    }
    res.send("Case stage deleted successfully.");
  });
});

module.exports = router;