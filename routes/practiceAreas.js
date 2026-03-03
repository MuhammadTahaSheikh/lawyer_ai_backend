// routes/practiceAreas.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /practice_areas – create new practice area
router.post("/practice_areas", (req, res) => {
  const { practice_area_name, active_case, uid } = req.body;

  if (!practice_area_name || !uid) {
    return res.status(400).send("Missing required fields.");
  }

  // Query to check if the practice_area_name already exists
  const checkQuery =
    "SELECT COUNT(*) AS count FROM practice_area WHERE practice_area_name = ?";

  db.query(checkQuery, [practice_area_name], (err, result) => {
    if (err) {
      console.error("Error checking practice area:", err);
      return res.status(500).send("Error checking practice area.");
    }

    if (result[0].count > 0) {
      return res.status(409).send("Practice area name already exists.");
    }

    // Fetch user's full name
    const getUserQuery = `SELECT CONCAT(first_name, ' ', last_name) AS full_name FROM active_users WHERE uid = ?`;

    db.query(getUserQuery, [uid], (err, userResult) => {
      if (err) {
        console.error("Error fetching user:", err);
        return res.status(500).send("Error fetching user.");
      }

      if (userResult.length === 0) {
        return res.status(404).send("User not found.");
      }

      const created_by = userResult[0].full_name;

      // Insert into practice_area table
      const insertQuery = `
        INSERT INTO practice_area (practice_area_name, active_case, created_by, uid, created_at) 
        VALUES (?, ?, ?, ?, NOW())
      `;

      const values = [practice_area_name, active_case || 0, created_by, uid];

      db.query(insertQuery, values, (err, insertResult) => {
        if (err) {
          console.error("Error adding practice area:", err);
          return res.status(500).send("Error adding practice area.");
        }

        res.status(201).json({
          message: "Practice area created successfully",
          practice_area_id: insertResult.insertId,
        });
      });
    });
  });
});

// GET /practice_areas – fetch all practice areas with case counts
router.get("/practice_areas", (req, res) => {
  const query = `
   SELECT pa.id, pa.practice_area_name, pa.created_by, 
       COALESCE(SUM(CASE WHEN c.case_id IS NOT NULL AND (c.closed_date IS NULL OR c.closed_date = '') THEN 1 ELSE 0 END), 0) AS case_count
   FROM practice_area pa
   LEFT JOIN cases c ON pa.practice_area_name = c.practice_area
   GROUP BY pa.id, pa.practice_area_name, pa.created_by;
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching practice areas:", err);
      return res.status(500).send("Error fetching practice areas.");
    }
    res.status(200).json(results);
  });
});

// GET /practice_areas/:id – fetch single practice area
router.get("/practice_areas/:id", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM practice_area WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Error fetching practice area:", err);
      return res.status(500).send("Error fetching practice area.");
    }
    if (!result.length) return res.status(404).send("Practice area not found.");
    res.status(200).json(result[0]);
  });
});

// PUT /practice_areas/:id – update a practice area
router.put("/practice_areas/:id", (req, res) => {
  const { id } = req.params;
  const { practice_area_name, active_case, created_by, uid } = req.body;
  if (!practice_area_name) return res.status(400).json({ error: "Practice area name is required." });
  const checkQuery = `
    SELECT COUNT(*) AS count FROM practice_area WHERE practice_area_name = ? AND id != ?
  `;
  db.query(checkQuery, [practice_area_name, id], (err, result) => {
    if (err) {
      console.error("Database error during practice area check:", err);
      return res.status(500).json({ error: "Internal server error while checking duplicate names." });
    }
    if (result[0].count > 0) return res.status(409).json({ error: "Practice area name already exists. Choose a different name." });
    const updateQuery = `
      UPDATE practice_area
      SET practice_area_name = ?, active_case = ?, created_by = ?, uid = ?, created_at = NOW()
      WHERE id = ?
    `;
    db.query(updateQuery, [practice_area_name, active_case || 0, created_by, uid, id], (err, result) => {
      if (err) {
        console.error("Database error during update:", err);
        return res.status(500).json({ error: "Internal server error while updating practice area." });
      }
      if (!result.affectedRows) return res.status(404).json({ error: "Practice area not found. No update was made." });
      res.status(200).json({ message: "Practice area updated successfully." });
    });
  });
});

// DELETE /practice_areas/:id – delete a practice area
router.delete("/practice_areas/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM practice_area WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Error deleting practice area:", err);
      return res.status(500).send("Error deleting practice area.");
    }
    if (!result.affectedRows) return res.status(404).send("Practice area not found.");
    res.status(200).json({ message: "Practice area deleted successfully" });
  });
});

module.exports = router;