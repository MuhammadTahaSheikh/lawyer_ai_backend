// routes/caseNotes.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const logger = require("../logger");

router.use(express.json({ limit: "5000mb" }));
router.use(express.urlencoded({ limit: "5000mb", extended: true }));

/** One row per note — scalar lookups only (active_users can have duplicate staff_id). */
const CASE_NOTE_STAFF_NAME = (staffIdCol) =>
  `COALESCE(
    (SELECT NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '')
     FROM active_users au WHERE au.staff_id = ${staffIdCol}
     ORDER BY au.updated_at DESC NULLS LAST
     LIMIT 1),
    (SELECT NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '')
     FROM staff s WHERE s.staff_id = ${staffIdCol} LIMIT 1)
  )`;

const CASE_NOTE_LIST_SELECT = `
  SELECT
    cn.id,
    cn.case_id,
    cn.subject,
    cn.note,
    cn.date,
    cn.created_at AS "createdAt",
    cn.updated_at AS "updatedAt",
    ${CASE_NOTE_STAFF_NAME("cn.created_by_id")} AS "createdBy",
    ${CASE_NOTE_STAFF_NAME("cn.updated_by_id")} AS "updatedBy"
  FROM case_notes_record cn`;

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

// POST /case_notes – create a new case note
router.post("/case_notes", async (req, res) => {
  const { case_id, subject, note, date } = req.body;
  const userUid = req.headers["x-user-uid"];
 
  if (!userUid) {
    return res.status(401).send("User UID missing in request headers");
  }
 
  try {
    const [staffResult] = await db.promise().query(
      `SELECT staff_id FROM active_users WHERE uid = ?`,
      [userUid]
    );
    if (staffResult.length === 0) {
      return res.status(404).send("Staff not found for UID");
    }
    const staffId = staffResult[0].staff_id;
 
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
    });
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
 
    const insertQuery = `
      INSERT INTO case_notes_record
        (case_id, subject, note, date, created_by_id, updated_by_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const [insertResult] = await db.promise().query(insertQuery, [
      case_id, subject, note, date,
      staffId, staffId, formattedDate, formattedDate,
    ]);
 
    await db.promise().query(
      `INSERT INTO case_note_logs
         (note_id, action, case_id, uid, timestamp)
       VALUES (?, 'create', ?, ?, ?)`,
      [insertResult.insertId, case_id, userUid, formattedDate]
    );
 
    res.status(201).json({
      id: insertResult.insertId,
      case_id,
      subject,
      note,
      date
    });
  } catch (err) {
    logger.error("Error adding case note", {
      route: "POST /case_notes",
      userUid,
      payload: req.body,
      message: err.message,
      stack: err.stack
    });
    res.status(500).send("Error adding case note.");
  }
});

// PUT /case_notes/:id – update a case note

router.put("/case_notes/:id", async (req, res) => {

  const { id } = req.params;

  const updatedFields = {};

  if ('subject' in req.body) updatedFields.subject = req.body.subject;

  if ('note' in req.body)    updatedFields.note    = req.body.note;
 
  const userUid = req.headers['x-user-uid'];

  if (!userUid) {

    return res.status(401).json({ error: "User UID missing in request headers" });

  }
 
  try {

    const [existingNotes] = await db.promise().query(

      "SELECT * FROM case_notes_record WHERE id = ?",

      [id]

    );

    if (existingNotes.length === 0) {

      return res.status(404).send("Case note not found.");

    }

    const existingNote = existingNotes[0];
 
    if ('date' in req.body) {

  updatedFields.date = req.body.date;

}
 
 
    const timestamp = new Date().toLocaleString("en-US", {

      timeZone: "America/New_York",

      hour12: false,

    });

    const [datePart, timePart] = timestamp.split(', ');

    const [month, day, year] = datePart.split('/');

    const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;

    updatedFields.updated_at = formattedDate;
 
    const [staffResult] = await db.promise().query(

      `SELECT staff_id FROM active_users WHERE uid = ?`,

      [userUid]

    );

    if (staffResult.length === 0) {

      return res.status(404).send("Staff not found for UID");

    }

    updatedFields.updated_by_id = staffResult[0].staff_id;

    const setColumns = Object.keys(updatedFields);
    const setClause = setColumns.map((col) => `${col} = ?`).join(", ");
    const setValues = setColumns.map((col) => updatedFields[col]);

    await db.promise().query(
      `UPDATE case_notes_record SET ${setClause} WHERE id = ?`,
      [...setValues, id]
    );
 
    for (const key of Object.keys(updatedFields)) {

      if (key === 'updated_at') continue;

      let oldVal = existingNote[key];

      let newVal = updatedFields[key];

      if (key === 'date') {

        oldVal = new Date(oldVal).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });

        newVal = new Date(newVal).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });

      }

      if (`${oldVal}` !== `${newVal}`) {

        await db.promise().query(

          `INSERT INTO case_note_logs

             (uid, note_id, action, case_id, timestamp, field_name, old_value, new_value)

           VALUES (?, ?, 'update', ?, ?, ?, ?, ?)`,

          [userUid, id, existingNote.case_id, formattedDate, key, `${oldVal}`, `${newVal}`]

        );

      }

    }
 
    res.json({ id, ...updatedFields });

  } catch (err) {

    logger.error("Error updating case note", {

      route: `PUT /case_notes/${id}`,

      userUid,

      payload: req.body,

      message: err.message,

      stack: err.stack

    });

    res.status(500).send("Error updating case note.");

  }

});
 

// GET /case_notes/recent-activity – recent activity logs for case notes
router.get("/case_notes/recent-activity", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT
         log.*,
         cn.subject AS note_subject,
         cn.note    AS note_content,
         c.name     AS case_name,
         c.case_number,
         au.first_name,
         au.last_name
       FROM case_note_logs log
       JOIN case_notes_record cn ON log.note_id = cn.id
       LEFT JOIN cases c ON log.case_id = c.case_id
       LEFT JOIN active_users au ON log.uid = au.uid
       ORDER BY log.timestamp DESC
       LIMIT 50`
    );
    res.json(formatActivities(rows));
  } catch (err) {
    logger.error("Error fetching recent activity for case notes", {
      route: "GET /case_notes/recent-activity",
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: "Failed to fetch recent activity for case notes" });
  }
});

// GET /case_notes – list case notes with pagination and search
router.get("/case_notes", async (req, res) => {
  const { case_id, search, page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;
  let conditions = [];
  let values = [];
 
  if (case_id) {
    conditions.push("cn.case_id = ?");
    values.push(case_id);
  }
 
  if (search) {
    conditions.push("(LOWER(cn.subject) LIKE ? OR LOWER(cn.note) LIKE ?)");
    values.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
 
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
 
  const countFrom = `FROM case_notes_record cn`;

  try {
    const [[{ total }]] = await db.promise().query(
      `SELECT COUNT(*) AS total ${countFrom} ${whereClause}`,
      values
    );
    const totalNotes = Number(total) || 0;

    const [rows] = await db.promise().query(
      `
      ${CASE_NOTE_LIST_SELECT}
      ${whereClause}
      ORDER BY cn.date DESC, cn.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...values, limit, offset]
    );
 
    const formatDate = date =>
      new Date(date).toLocaleString("en-US", {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
 
    const caseNotes = rows.map(n => ({
      ...n,
      date:      formatDate(n.date),
      createdAt: formatDate(n.createdAt),
      updatedAt: formatDate(n.updatedAt)
    }));
 
    res.json({ totalNotes, caseNotes });
  } catch (err) {
    logger.error("Error fetching case notes", {
      route: "GET /case_notes",
      query: req.query,
      message: err.message,
      stack: err.stack
    });
    res.status(500).send("Error fetching case notes.");
  }
});
 // GET /case_notes/export/:case_id – export all case notes for a case (no pagination)
// IMPORTANT: This route must come before /case_notes/:case_id to avoid route conflicts
router.get("/case_notes/export/:case_id", async (req, res) => {
  const { case_id } = req.params;
  const { search } = req.query;
  
  let conditions = [];
  let values = [];
  
  conditions.push("cn.case_id = ?");
  values.push(case_id);
  
  if (search) {
    conditions.push("(LOWER(cn.subject) LIKE ? OR LOWER(cn.note) LIKE ?)");
    values.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  
  try {
    const [rows] = await db.promise().query(
      `
      ${CASE_NOTE_LIST_SELECT}
      ${whereClause}
      ORDER BY cn.date DESC, cn.created_at DESC
      `,
      values
    );
    
    const formatDate = date =>
      new Date(date).toLocaleString("en-US", {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    
    const caseNotes = rows.map(n => ({
      ...n,
      date:      formatDate(n.date),
      createdAt: formatDate(n.createdAt),
      updatedAt: formatDate(n.updatedAt)
    }));
    
    res.json({ 
      totalNotes: caseNotes.length,
      caseNotes 
    });
  } catch (err) {
    logger.error("Error exporting case notes", {
      route: `GET /case_notes/export/${case_id}`,
      query: req.query,
      message: err.message,
      stack: err.stack
    });
    res.status(500).send("Error exporting case notes.");
  }
});
// GET /case_notes/:case_id – fetch case notes by case_id (all)
router.get("/case_notes/:case_id", (req, res) => {
  const { case_id } = req.params;
  db.query(
    "SELECT * FROM case_notes_record WHERE case_id = ? ORDER BY created_at DESC",
    [case_id],
    (err, results) => {
      if (err) {
        logger.error("Error fetching case notes by case_id", {
          route: `GET /case_notes/${case_id}`,
          message: err.message,
          stack: err.stack
        });
        return res.status(500).send("Error fetching case notes.");
      }
      if (results.length === 0) {
        return res.status(404).send("No case notes found for this case ID.");
      }
      res.json(results);
    }
  );
});

// DELETE /case_notes/:id – delete a case note
router.delete("/case_notes/:id", (req, res) => {
  const { id } = req.params;
  db.query(
    "DELETE FROM case_notes_record WHERE id = ?",
    [id],
    (err, result) => {
      if (err) {
        logger.error("Error deleting case note", {
          route: `DELETE /case_notes/${id}`,
          message: err.message,
          stack: err.stack
        });
        return res.status(500).send("Error deleting case note.");
      }
      if (result.affectedRows === 0) {
        return res.status(404).send("Case note not found.");
      }
      res.json({ message: "Case note deleted successfully." });
    }
  );
});

router.get("/case_notes_all/:case_id", async (req, res) => {
  const { case_id } = req.params;
  const { search } = req.query;
  
  let conditions = [];
  let values = [];
  
  conditions.push("cn.case_id = ?");
  values.push(case_id);
  
  if (search) {
    conditions.push("(LOWER(cn.subject) LIKE ? OR LOWER(cn.note) LIKE ?)");
    values.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  
  try {
    const [rows] = await db.promise().query(
      `
      ${CASE_NOTE_LIST_SELECT}
      ${whereClause}
      ORDER BY cn.date DESC, cn.created_at DESC
      `,
      values
    );
    
    const formatDate = date =>
      new Date(date).toLocaleString("en-US", {
        year:   'numeric',
        month:  'long',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    
    const caseNotes = rows.map(n => ({
      ...n,
      date:      formatDate(n.date),
      createdAt: formatDate(n.createdAt),
      updatedAt: formatDate(n.updatedAt)
    }));
    
    res.json({
      totalNotes: caseNotes.length,
      caseNotes
    });
  } catch (err) {
    logger.error("Error fetching all case notes", {
      route: `GET /case_notes_all/${case_id}`,
      query: req.query,
      message: err.message,
      stack: err.stack
    });
    res.status(500).send("Error fetching all case notes.");
  }
});
 
// POST /case_notes/with_time_entry — create a time entry + a case note (same case) atomically
router.post("/case_notes/with_time_entry", async (req, res) => {
  const userUid = req.headers["x-user-uid"];
  if (!userUid) {
    return res.status(401).json({ error: "User UID missing in request headers" });
  }

  // --- Expected body payload ---
  // {
  //   case_id: 40292784,
  //   // time entry fields:
  //   description: "Phone consult",
  //   entry_date: "2025-11-03",      // YYYY-MM-DD or full DATETIME; if omitted uses now EST
  //   billable: 1,                   // 1 or 0 (defaults to 1 if omitted)
  //   activity_name: "CONSULT",
  //   rate: 300,
  //   hours: 1.25,
  //   flat_fee: null,                // optional
  //
  //   // note fields:
  //   note_subject: "Client call re: docs",  // optional (default from activity/description)
  //   note: "Asked client for photos"        // optional (default from description)
  // }

  const {
    case_id,
    description,
    entry_date,
    billable = 1,
    activity_name,
    rate,
    hours,
    flat_fee,

    note_subject,
    note
  } = req.body;

  // Minimal validation aligned with your /time_entries POST route
  if (!case_id) return res.status(400).json({ error: "case_id is required" });
  if (!description) return res.status(400).json({ error: "description is required" });
  if (!activity_name) return res.status(400).json({ error: "activity_name is required" });
  if (rate == null) return res.status(400).json({ error: "rate is required" });
  if (hours == null) return res.status(400).json({ error: "hours is required" });

  // Helper: EST timestamp in `YYYY-MM-DD HH:mm:ss`
  const nowEST = () => {
    const ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    const [datePart, timePart] = ts.split(", ");
    const [m, d, y] = datePart.split("/");
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${timePart}`;
  };

  // Normalize entry date (accept YYYY-MM-DD or pass-through DATETIME)
  const normalizeEntryDate = (d) => {
    if (!d) return nowEST();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d} 00:00:00` : d;
  };

  const createdAt = nowEST();
  const entryDateDT = normalizeEntryDate(entry_date);

  const conn = await db.promise().getConnection();
  try {
    // Resolve staff_id from active_users via UID
    const [staffRows] = await conn.query(
      "SELECT staff_id FROM active_users WHERE uid = ? LIMIT 1",
      [userUid]
    );
    if (!staffRows.length) {
      conn.release();
      return res.status(404).json({ error: "Staff not found for UID" });
    }
    const staffId = staffRows[0].staff_id;

    await conn.beginTransaction();

    // 1) Insert time entry (mirrors your /time_entries INSERT columns/order)
    const [timeInsert] = await conn.query(
      `INSERT INTO time_entries
        (description, entry_date, billable, case_id, staff_id, activity_name,
         created_at, updated_at, rate, flat_fee, hours, uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        description,
        entryDateDT,
        billable ? 1 : 0,
        case_id,
        staffId,
        activity_name,
        createdAt,
        createdAt,
        rate,
        flat_fee ?? null,
        hours,
        userUid
      ]
    );
    const time_entry_id = timeInsert.insertId;

    // 1a) Log time entry creation
    await conn.query(
      `INSERT INTO time_entry_logs (time_entry_id, action, case_id, uid, timestamp)
       VALUES (?, 'create', ?, ?, ?)`,
      [time_entry_id, case_id, userUid, createdAt]
    );

    // 2) Insert case note (into case_notes_record — matches your create route)
    const subjectFinal = note_subject ?? `Time Entry #${time_entry_id} — ${activity_name}`;
    const noteFinal = note ?? description;

    const [noteInsert] = await conn.query(
      `INSERT INTO case_notes_record
        (case_id, subject, note, date, created_by_id, updated_by_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        case_id,
        subjectFinal,
        noteFinal,
        entryDateDT, // align note date to entry_date
        staffId,
        staffId,
        createdAt,
        createdAt
      ]
    );
    const note_id = noteInsert.insertId;

    // 2a) Log case note creation
    await conn.query(
      `INSERT INTO case_note_logs (note_id, action, case_id, uid, timestamp)
       VALUES (?, 'create', ?, ?, ?)`,
      [note_id, case_id, userUid, createdAt]
    );

    await conn.commit();

    return res.status(201).json({
      message: "Time entry and case note created.",
      time_entry_id,
      note_id,
      case_id,
      timestamps: { created_at: createdAt, entry_date: entryDateDT }
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error("Error creating time entry + note", {
      route: "POST /case_notes/with_time_entry",
      userUid,
      payload: req.body,
      message: err.message,
      stack: err.stack
    });
    return res.status(500).json({ error: "Failed to create time entry and note" });
  } finally {
    try { conn.release(); } catch (_) {}
  }
});



module.exports = router;