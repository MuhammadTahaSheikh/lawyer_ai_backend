// routes/events.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// Helper function to get the correct Eastern Time offset based on date
const getEasternOffset = (dateStr) => {
  // Create a date object and check if it's in DST
  const date = new Date(dateStr);
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = date.getTimezoneOffset() < stdOffset;
  
  // For Eastern Time: EDT is -04:00, EST is -05:00
  // We need to check if the DATE itself is in DST, not the current date
  const testDate = new Date(dateStr + 'T12:00:00');
  const options = { timeZone: 'America/New_York', timeZoneName: 'short' };
  const tzName = testDate.toLocaleString('en-US', options).split(' ').pop();
  
  return tzName === 'EDT' ? '-04:00' : '-05:00';
};

// Helper to format date for Eastern Time output
const formatForEasternOutput = (dbDateString) => {
  if (!dbDateString) return null;
  
  // DB stores as "YYYY-MM-DD HH:mm:ss" in Eastern Time
  // Convert to ISO format with correct offset
  const dateStr = dbDateString.toString().replace(" ", "T");
  const offset = getEasternOffset(dateStr);
  return dateStr + offset;
};
 
// PUT /events/:id – update an event
router.put("/events/:id", async (req, res) => {
  const eventId = req.params.id;
  const { event_name, event_description, start_event, end_event, location } = req.body;
  const userUid = req.headers["x-user-uid"];
 
  try {
    // Fetch existing event
    const [existingRows] = await db.promise().query(
      "SELECT * FROM case_events WHERE id = ?",
      [eventId]
    );
 
    if (existingRows.length === 0) {
      return res.status(404).send("Event not found.");
    }
 
    const existing = existingRows[0];
    let case_id = existing.case_id;
    if (!case_id && req.body.case_id) {
      case_id = req.body.case_id;
    }

    const updates = [];
    const changes = [];

    // Helper function to normalize dates - treats input as Eastern Time directly
    const normalizeEasternDate = (dateString) => {
      if (!dateString) return '';
      
      // If it's already in DB format (YYYY-MM-DD HH:mm:ss), return as-is
      if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        return dateString;
      }
      
      // Handle ISO format from frontend (2025-05-23T10:00 or 2025-05-23T10:00:00)
      // The frontend sends the time as the user sees it (Eastern Time)
      // We just need to extract and reformat it, NOT convert timezones
      if (typeof dateString === 'string' && dateString.includes('T')) {
        // Remove any timezone offset if present (we trust the time value as Eastern)
        let cleanDate = dateString;
        
        // Remove timezone offset like -04:00, -05:00, or Z
        cleanDate = cleanDate.replace(/[-+]\d{2}:\d{2}$/, '').replace(/Z$/, '');
        
        // Parse the components directly (no Date object to avoid timezone conversion)
        const match = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
          const [, year, month, day, hour, minute, second = '00'] = match;
          return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        }
      }
      
      // Fallback: try to parse with Date (less reliable)
      const date = new Date(dateString);
      if (!isNaN(date)) {
        return date.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).replace(/(\d+)\/(\d+)\/(\d+),? (\d+:\d+:\d+)/, '$3-$1-$2 $4');
      }
      
      return '';
    };

    // Helper to normalize existing DB date for comparison
    const normalizeExistingDate = (dbDate) => {
      if (!dbDate) return '';
      
      // Handle Date objects from MySQL
      if (dbDate instanceof Date) {
        const year = dbDate.getFullYear();
        const month = String(dbDate.getMonth() + 1).padStart(2, '0');
        const day = String(dbDate.getDate()).padStart(2, '0');
        const hours = String(dbDate.getHours()).padStart(2, '0');
        const minutes = String(dbDate.getMinutes()).padStart(2, '0');
        const seconds = String(dbDate.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
      
      // Handle string format
      if (typeof dbDate === 'string') {
        if (dbDate.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
          return dbDate;
        }
        // Handle ISO format
        if (dbDate.includes('T')) {
          return dbDate.replace('T', ' ').replace(/[-+]\d{2}:\d{2}$/, '').replace(/Z$/, '').substring(0, 19);
        }
      }
      
      return '';
    };
 
    if (req.body.event_type !== undefined && req.body.event_type !== existing.event_type) {
      updates.push("event_type = ?");
      changes.push(["event_type", existing.event_type, req.body.event_type]);
    }

    if (event_name && event_name !== existing.event_name) {
      updates.push("event_name = ?");
      changes.push(["event_name", existing.event_name, event_name]);
    }

    if (event_description !== undefined) {
      const normalizeHTML = (html) => {
        if (!html) return '';
        return html
          .replace(/<br\s*\/?>/gi, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\s+/g, ' ')
          .replace(/ class="[^"]*"/gi, '')
          .replace(/ style="[^"]*"/gi, '')
          .replace(/<p>\s*<\/p>/gi, '')
          .trim();
      };
      const currentNormalized = normalizeHTML(existing.event_description || '');
      const newNormalized = normalizeHTML(event_description || '');
      if (newNormalized !== currentNormalized) {
        updates.push("event_description = ?");
        changes.push(["event_description", existing.event_description, event_description]);
      }
    }

    if (start_event) {
      const normalizedExisting = normalizeExistingDate(existing.start_event);
      const normalizedNew = normalizeEasternDate(start_event);
      console.log(`[DEBUG] start_event comparison: existing="${normalizedExisting}" vs new="${normalizedNew}"`);
      if (normalizedNew && normalizedNew !== normalizedExisting) {
        updates.push("start_event = ?");
        changes.push(["start_event", existing.start_event, normalizedNew]);
      }
    }

    if (end_event) {
      const normalizedExisting = normalizeExistingDate(existing.end_event);
      const normalizedNew = normalizeEasternDate(end_event);
      console.log(`[DEBUG] end_event comparison: existing="${normalizedExisting}" vs new="${normalizedNew}"`);
      if (normalizedNew && normalizedNew !== normalizedExisting) {
        updates.push("end_event = ?");
        changes.push(["end_event", existing.end_event, normalizedNew]);
      }
    }

    if (location !== undefined) {
      const currentLocation = existing.location === "" ? "No location" : existing.location;
      const newLocation = location === "" ? "No location" : location;
      if (newLocation !== currentLocation) {
        updates.push("location = ?");
        changes.push(["location", existing.location, location]);
      }
    }

    if (req.body.case_id && req.body.case_id !== existing.case_id) {
      updates.push("case_id = ?");
      changes.push(["case_id", existing.case_id, req.body.case_id]);
      case_id = req.body.case_id;
    }

    if (updates.length === 0) {
      return res.status(400).send("No changes to update.");
    }
 
    const updateQuery = `UPDATE case_events SET ${updates.join(", ")} WHERE id = ?`;
    const values = [...changes.map(([, , newVal]) => newVal), eventId];
    
    console.log(`[DEBUG] Update query: ${updateQuery}`);
    console.log(`[DEBUG] Update values:`, values);
 
    const [updateResult] = await db.promise().query(updateQuery, values);
 
    if (updateResult.affectedRows === 0) {
      return res.status(404).send("Event not found.");
    }
 
    // Get current time in Eastern Time
    const now = new Date();
    const createdAt = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false
    }).replace(/(\d+)\/(\d+)\/(\d+),? (\d+:\d+:\d+)/, '$3-$1-$2 $4');
 
    // Log activity
    for (const [field, oldValue, newValue] of changes) {
      await db.promise().query(
        "INSERT INTO case_event_logs (event_id, action, field_name, old_value, new_value, case_id, uid, timestamp) VALUES (?, 'update', ?, ?, ?, ?, ?, ?)",
        [eventId, field, oldValue, newValue, case_id ?? null, userUid, createdAt]
      );
    }
 
    res.send("Event updated successfully.");
  } catch (err) {
    console.error("Error updating event:", err);
    res.status(500).send("Error updating event.");
  }
});
 
router.delete("/events/:id", async (req, res) => {
  const eventId = req.params.id;
 
  // Step 1: Fetch event BEFORE deletion so you can log it later
  let existingRows = [];
  try {
    const [rows] = await db.promise().query(
      `SELECT e.*, c.name AS case_name
       FROM case_events e
       LEFT JOIN cases c ON e.case_id = c.case_id
       WHERE e.id = ?`,
      [eventId]
    );
    if (rows.length === 0) {
      return res.status(404).send("Event not found.");
    }
    existingRows = rows;
  } catch (fetchErr) {
    console.error("Error fetching event before deletion:", fetchErr);
    return res.status(500).send("Error retrieving event.");
  }
 
  db.getConnection((err, conn) => {
    if (err) {
      console.error("Error getting DB connection for transaction:", err);
      return res.status(500).send("Database connection error.");
    }
 
    conn.beginTransaction((err) => {
      if (err) {
        conn.release();
        console.error("Error starting transaction:", err);
        return res.status(500).send("Error starting transaction.");
      }
 
      // Step 2: Delete from child table
      conn.query(
        "DELETE FROM case_event_logs WHERE event_id = ?",
        [eventId],
        (err) => {
          if (err) {
            return conn.rollback(() => {
              conn.release();
              console.error("Error deleting event logs:", err);
              res.status(500).send("Error deleting event logs.");
            });
          }
 
          // Step 3: Delete from parent table
          conn.query(
            "DELETE FROM case_events WHERE id = ?",
            [eventId],
            (err, result) => {
              if (err) {
                return conn.rollback(() => {
                  conn.release();
                  console.error("Error deleting event:", err);
                  res.status(500).send("Error deleting event.");
                });
              }
 
              if (result.affectedRows === 0) {
                return conn.rollback(() => {
                  conn.release();
                  res.status(404).send("Event not found.");
                });
              }
 
              // Step 4: Commit and log the deletion
              conn.commit(async (err) => {
                if (err) {
                  return conn.rollback(() => {
                    conn.release();
                    console.error("Error committing transaction:", err);
                    res.status(500).send("Error committing transaction.");
                  });
                }
 
                try {
                  const userUid = req.headers["x-user-uid"] || null;
                  const deletedAt = new Date().toLocaleString("en-US", {
                    timeZone: "America/New_York",
                    hour12: false,
                  }).replace(/(\d+)\/(\d+)\/(\d+),? (\d+:\d+:\d+)/, '$3-$1-$2 $4');
 
                  await db.promise().query(
                    `INSERT INTO case_event_logs (
                       event_id, action, field_name, old_value, new_value, case_id, uid, timestamp
                     )
                     VALUES (?, 'delete', ?, ?, NULL, ?, ?, ?)`,
                    [
                      eventId,
                      'event_name',
                      `${existingRows[0].event_name || 'Unnamed Event'} (Case: ${existingRows[0].case_name || 'Unknown'})`,
                      existingRows[0].case_id,
                      userUid,
                      deletedAt
                    ]
                  );
 
                } catch (logErr) {
                  console.error("Error logging event deletion:", logErr);
                }
 
                conn.release();
                res.send("Event deleted successfully.");
              });
            }
          );
        }
      );
    });
  });
});
 
// POST /events – add new event
router.post("/events", async (req, res) => {
  const {
    case_id,
    case_name: bodyCaseName,
    event_name,
    event_description,
    start_event,
    end_event,
    location,
    event_type,
    created_by,
  } = req.body;
 
  if (!event_name || !start_event || !end_event) {
    return res.status(400).send("Missing required fields.");
  }
 
  // Get UID from header (for logging)
  const userUid = req.headers["x-user-uid"];
  if (!userUid) {
    return res.status(401).send("User UID missing in request headers");
  }

  let case_name = bodyCaseName;
  const resolvedCaseId = case_id || null;
  if (resolvedCaseId && !case_name) {
    try {
      const [rows] = await db.promise().query(
        "SELECT name FROM cases WHERE case_id = ?",
        [resolvedCaseId]
      );
      case_name = rows[0]?.name;
    } catch (lookupErr) {
      console.error("Error looking up case name:", lookupErr);
      return res.status(500).send("Error adding event.");
    }
  }
  if (!case_name) {
    case_name = resolvedCaseId ? "Unknown Case" : "No associated case";
  }

  // Get Florida (Eastern Time) formatted date
  const createdAt = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
  }).replace(",", "").replace(/\//g, "-");
 
  // Convert to MySQL datetime format (YYYY-MM-DD HH:mm:ss)
  const [month, day, yearAndTime] = createdAt.split("-");
  const [year, time] = yearAndTime.split(" ");
  const formattedCreatedAt = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${time}`;
 
  const insertQuery = `
    INSERT INTO case_events (case_id, case_name, event_name, event_description, start_event, end_event, location, event_type, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
 
  db.query(
    insertQuery,
    [
      resolvedCaseId,
      case_name,
      event_name,
      event_description,
      start_event,
      end_event,
      location,
      event_type,
      created_by,
      formattedCreatedAt
    ],
    async (err, result) => {
      if (err) {
        console.error("Error adding event:", err);
        return res.status(500).send("Error adding event.");
      }
 
      // Log event creation using UID from headers
      await db.promise().query(
        "INSERT INTO case_event_logs (event_id, action, case_id, uid, timestamp) VALUES (?, 'create', ?, ?, ?)",
        [result.insertId, resolvedCaseId, userUid, formattedCreatedAt]
      );
 
      res.status(201).send({ id: result.insertId, ...req.body });
    }
  );
});
 
// GET /events – fetch all events for calendar
router.get("/events", async (req, res) => {
  try {
    const { start, end, dueTodayOnly, uid } = req.query;
    let whereConditions = [];
    let queryParams = [];
 
    // Handle date filtering (existing functionality)
    if (dueTodayOnly === "true") {
      whereConditions.push(`DATE(e.start_event) = CURDATE()`);
    } else if (start && end) {
      whereConditions.push(`e.start_event BETWEEN ? AND ?`);
      queryParams.push(start, end);
    }
 
    // Get user's case permissions if uid is provided
    let userCaseIds = [];
    let userPracticeAreas = [];
   
    if (uid && req.query.show_all !== 'true') {
      const permissionQuery = `
        SELECT
          (SELECT GROUP_CONCAT(DISTINCT case_id) FROM user_case_assignments WHERE uid = ?) AS case_ids,
          (SELECT GROUP_CONCAT(DISTINCT practice_area) FROM user_practice_areas WHERE uid = ?) AS practice_areas
      `;
     
      const [permissionResult] = await db.promise().query(permissionQuery, [uid, uid]);
     
      userCaseIds = permissionResult[0]?.case_ids?.split(',').map(Number).filter(Boolean) || [];
      userPracticeAreas = permissionResult[0]?.practice_areas?.split(',').map(String).filter(Boolean) || [];
    }
 
    // Apply case permission filtering if needed
    if (uid && req.query.show_all !== 'true' && (userCaseIds.length > 0 || userPracticeAreas.length > 0)) {
      const permissionConditions = [];
     
      // Add direct ownership check
      permissionConditions.push(`(c.uid = ? OR c.assigned_attorney_uid = ?)`);
      queryParams.push(uid, uid);
 
      if (userCaseIds.length) {
        permissionConditions.push(`e.case_id IN (${userCaseIds.map(() => '?').join(',')})`);
        queryParams.push(...userCaseIds);
      }
 
      if (userPracticeAreas.length) {
        permissionConditions.push(`c.practice_area IN (${userPracticeAreas.map(() => '?').join(',')})`);
        queryParams.push(...userPracticeAreas);
      }
 
      // if (permissionConditions.length > 0) {
      //   whereConditions.push(`(${permissionConditions.join(' OR ')})`);
      // }
      if (permissionConditions.length > 0) {
    // Keep existing permission checks while including non-case/orphaned events.
    whereConditions.push(`(e.case_id IS NULL OR c.case_id IS NULL OR ${permissionConditions.join(' OR ')})`);
  }
    }
 
    // Build the final WHERE clause
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
 
    const eventsQuery = `
      SELECT
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
      LEFT JOIN cases c ON e.case_id = c.case_id
      ${whereClause}
      ORDER BY e.start_event ASC
    `;
 
    const [results] = await db.promise().query(eventsQuery, queryParams);
 
    const formattedEvents = results.map((event) => ({
      id:          event.id,
      title:       event.event_name || "Unnamed Event",
      description: event.event_description || "No description available",
      start:       event.start_event,
      end:         event.end_event,
      case_name:   event.case_name || "No associated case",
      case_id:     event.case_id,
      event_type:  event.event_type,
      staff:       event.staff,
      staff_name:  event.staff_names || "No staff assigned",
      location:    event.location || "No location"
    }));
 
    res.json(formattedEvents);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: "Error fetching events" });
  }
});

// GET /api/events – fetch events by case_id
router.get("/api/events", (req, res) => {
  const caseId = req.query.case_id;
  if (!caseId) return res.status(400).json({ error: "Missing case_id parameter" });
  
  const eventQuery = `
   SELECT
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
      et.color_code,
      GROUP_CONCAT(CONCAT(s.first_name, ' ', s.last_name) SEPARATOR ', ') AS staff_names
    FROM case_events e
    LEFT JOIN cases c ON e.case_id = c.case_id
    LEFT JOIN event_types et ON e.event_type = et.event_type_name
    LEFT JOIN staff s ON FIND_IN_SET(s.staff_id, e.staff) > 0
    WHERE e.case_id = ?
    GROUP BY e.id, e.event_name, e.event_type, e.event_description, e.start_event, e.end_event,
             e.staff, e.location, c.name, c.case_id, et.color_code
  `;
  
  db.query(eventQuery, [caseId], (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
    if (!results.length) return res.status(404).json({ message: "No events found for this case" });
    
    const formattedEvents = results.map(event => {
      // Format start date with correct offset
      let startFormatted = null;
      if (event.start_event) {
        const startStr = event.start_event.toString().replace(" ", "T");
        const startOffset = getEasternOffset(startStr);
        startFormatted = startStr + startOffset;
      }
      
      // Format end date with correct offset
      let endFormatted = null;
      if (event.end_event) {
        const endStr = event.end_event.toString().replace(" ", "T");
        const endOffset = getEasternOffset(endStr);
        endFormatted = endStr + endOffset;
      }
      
      return {
        id: event.id,
        title: event.event_name || "Unnamed Event",
        description: event.event_description || "No description available",
        start: startFormatted,
        end: endFormatted,
        location: event.location || "No location specified",
        case_name: event.case_name || "No associated case",
        case_id: event.case_id,
        color_code: event.color_code || "#cccccc",
        event_type: event.event_type,
        staff: event.staff,
        staff_name: event.staff_names || "No staff assigned",
      };
    });
    
    res.json({ events: formattedEvents });
  });
});

router.get("/api/events/pag", (req, res) => {
  const { start, end, search, limit, page } = req.query;
  let whereConditions = [];
  let queryParams = [];
 
  // If start and end dates are provided
  if (start && end) {
    whereConditions.push(`e.start_event BETWEEN ? AND ?`);
    queryParams.push(start, end);
  }
 
  // If search keyword is provided
  if (search) {
    whereConditions.push(`(
      e.event_name LIKE ? OR
      e.event_description LIKE ? OR
      c.name LIKE ?
    )`);
    queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
 
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
 
  const queryLimit = limit ? parseInt(limit) : 20;
  const queryPage = page ? parseInt(page) : 1;
  const offset = (queryPage - 1) * queryLimit;
 
  const eventsQuery = `
    SELECT
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
    LEFT JOIN cases c ON e.case_id = c.case_id
    ${whereClause}
    ORDER BY e.start_event ASC
    LIMIT ? OFFSET ?
  `;
 
  queryParams.push(queryLimit, offset);
 
  db.query(eventsQuery, queryParams, (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).send("Error fetching events.");
    }
 
    const formattedEvents = results.map((event) => ({
      id:          event.id,
      title:       event.event_name || "Unnamed Event",
      description: event.event_description || "No description available",
      start:       event.start_event,
      end:         event.end_event,
      case_name:   event.case_name || "No associated case",
      case_id:     event.case_id,
      event_type:  event.event_type,
      staff:       event.staff,
      staff_name:  event.staff_names || "No staff assigned",
      location:    event.location || "No location"
    }));
 
    res.json(formattedEvents);
  });
});

// GET /api/eventsCaseDetail – fetch events by case_id with date range
router.get("/api/eventsCaseDetail", (req, res) => {
  const caseId = req.query.case_id;
  const startDate = req.query.start_date || new Date().toISOString().split("T")[0];
  const endDate = req.query.end_date || new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0];
  
  if (!caseId) return res.status(400).json({ error: "Missing case_id parameter" });
  
  const eventQuery = `
    SELECT e.id, e.event_name, e.event_type, e.event_description, e.start_event, e.end_event,
           e.staff, c.name AS case_name, c.case_id,
           GROUP_CONCAT(CONCAT(s.first_name, ' ', s.last_name) SEPARATOR ', ') AS staff_names
    FROM case_events e
    LEFT JOIN cases c ON e.case_id = c.case_id
    LEFT JOIN staff s ON FIND_IN_SET(s.staff_id, e.staff) > 0
    WHERE e.case_id = ? AND e.start_event >= ? AND e.end_event <= ?
    GROUP BY e.id, e.event_name, e.event_type, e.event_description, e.start_event, e.end_event,
             e.staff, c.name, c.case_id
  `;
  
  db.query(eventQuery, [caseId, startDate, endDate], (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
    if (!results.length) return res.status(404).json({ message: "No events found for this case" });
    
    const formattedEvents = results.map(event => {
      // Format start date with correct offset
      let startFormatted = null;
      if (event.start_event) {
        const startStr = event.start_event.toString().replace(" ", "T");
        const startOffset = getEasternOffset(startStr);
        startFormatted = startStr + startOffset;
      }
      
      // Format end date with correct offset
      let endFormatted = null;
      if (event.end_event) {
        const endStr = event.end_event.toString().replace(" ", "T");
        const endOffset = getEasternOffset(endStr);
        endFormatted = endStr + endOffset;
      }
      
      return {
        id: event.id,
        title: event.event_name || "Unnamed Event",
        description: event.event_description || "No description available",
        start: startFormatted,
        end: endFormatted,
        case_name: event.case_name || "No associated case",
        case_id: event.case_id,
        event_type: event.event_type,
        staff: event.staff,
        staff_name: event.staff_names || "No staff assigned",
      };
    });
    
    res.json({ events: formattedEvents });
  });
});
 
// GET /events/logs – get all event logs
router.get("/events/logs", async (req, res) => {
  try {
    const [logs] = await db.promise().query(`
      SELECT
        l.id,
        l.event_id,
        e.event_name,
        e.case_id,
        l.action,
        l.field_name,
        l.old_value,
        l.new_value,
        l.uid,
        l.case_id,
        u.first_name,
        u.last_name,
        l.timestamp
      FROM case_event_logs l
      LEFT JOIN case_events e ON l.event_id = e.id
      LEFT JOIN active_users u ON l.uid = u.uid
      ORDER BY l.timestamp DESC
    `);
 
    res.json(logs);
  } catch (err) {
    console.error("Error fetching event logs:", err);
    res.status(500).json({ error: "Error fetching event logs" });
  }
});
 
// GET /events/logs1 – get event logs for a specific event via query parameter
router.get("/events/logs1", async (req, res) => {
  const { eventId } = req.query;
  try {
    let query = `
      SELECT
        l.id,
        l.event_id,
        e.event_name,
        e.case_id,
        l.action,
        l.field_name,
        l.old_value,
        l.new_value,
        l.uid,
        l.case_id,
        u.first_name,
        u.last_name,
        l.timestamp
      FROM case_event_logs l
      LEFT JOIN case_events e ON l.event_id = e.id
      LEFT JOIN active_users u ON l.uid = u.uid
    `;
    const params = [];
 
    if (eventId) {
      query += ` WHERE l.event_id = ?`;
      params.push(Number(eventId));
    }
 
    query += ` ORDER BY l.timestamp DESC`;
 
    const [logs] = await db.promise().query(query, params);
 
    res.json(logs);
  } catch (err) {
    console.error("Error fetching event logs:", err);
    res.status(500).json({ error: "Error fetching event logs" });
  }
});
 
module.exports = router;