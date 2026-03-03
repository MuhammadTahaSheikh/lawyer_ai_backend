// routes/eventTypes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /event-types – create new event type
router.post("/event-types", (req, res) => {
  const { event_type_name, color_code } = req.body;
  if (!event_type_name || !color_code.match(/^#[0-9A-Fa-f]{6}$/)) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  const sql =
    "INSERT INTO event_types (event_type_name, color_code) VALUES (?, ?)";
  db.query(sql, [event_type_name, color_code], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId, event_type_name, color_code });
  });
});

// GET /event-types – fetch all event types
router.get("/event-types", (req, res) => {
  db.query("SELECT * FROM event_types", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET /event-types/:id – fetch single event type by id
router.get("/event-types/:id", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM event_types WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0)
      return res.status(404).json({ error: "Event type not found" });
    res.json(results[0]);
  });
});

// PUT /event-types/:id – update event type
router.put("/event-types/:id", (req, res) => {
  const { id } = req.params;
  const { event_type_name, color_code } = req.body;

  if (!event_type_name || !color_code.match(/^#[0-9A-Fa-f]{6}$/)) {
    return res.status(400).json({ error: "Invalid input data" });
  }

  const sql =
    "UPDATE event_types SET event_type_name = ?, color_code = ? WHERE id = ?";
  db.query(sql, [event_type_name, color_code, id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Event type not found" });
    res.json({ message: "Event type updated successfully" });
  });
});

// DELETE /event-types/:id – delete event type
router.delete("/event-types/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM event_types WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Event type not found" });
    res.json({ message: "Event type deleted successfully" });
  });
});

module.exports = router;