// routes/activity.js
const express = require("express");
const router = express.Router();
const db = require("../db");
router.get("/activities", async (req, res) => {
  try {
    const { tab = 'all', page = 1, limit = 20, user, uid } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const numericLimit = parseInt(limit);
 
    // Helper function to build user filter (unchanged)
    const buildUserFilter = (alias = 'au') => {
      if (!user) return '';
      const [firstName, ...rest] = user.split(' ');
      const lastName = rest.join(' ') || '';
      return ` AND ${alias}.first_name = ${db.escape(firstName)} AND ${alias}.last_name = ${db.escape(lastName)} `;
    };
 
    // Get user's case permissions if uid is provided (unchanged)
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
 
    // Build case filter condition based on permissions (modified to handle different table aliases)
    const buildCaseFilter = (caseIdColumn) => {
      if (!uid || req.query.show_all === 'true' || (userCaseIds.length === 0 && userPracticeAreas.length === 0)) {
        return { condition: '', params: [] };
      }
     
      const conditions = [];
      const params = [];
     
      // Add direct ownership check (using cases table alias 'c')
      conditions.push(`(c.uid = ? OR c.assigned_attorney_uid = ?)`);
      params.push(uid, uid);
 
      if (userCaseIds.length && caseIdColumn) {
        conditions.push(`${caseIdColumn} IN (${userCaseIds.map(() => '?').join(',')})`);
        params.push(...userCaseIds);
      }
 
      if (userPracticeAreas.length) {
        conditions.push(`c.practice_area IN (${userPracticeAreas.map(() => '?').join(',')})`);
        params.push(...userPracticeAreas);
      }
 
      return {
        condition: conditions.length > 0 ? ` AND (${conditions.join(' OR ')})` : '',
        params
      };
    };
 
    // Generate queries for each activity type with case filtering (modified to specify correct case ID column)
    const generateQuery = (baseQuery, options = {}) => {
      const { caseIdColumn, joinCases = true } = options;
      const caseFilter = buildCaseFilter(caseIdColumn);
      let query = baseQuery;
     
      if (joinCases && caseFilter.condition) {
        // For queries that need to join with cases table
        if (!query.includes('JOIN cases c')) {
          // Handle different join conditions based on query type
          if (query.includes('FROM case_event_logs')) {
            query = query.replace(/WHERE/i, 'LEFT JOIN cases c ON e.case_id = c.case_id WHERE');
          } else if (query.includes('FROM document_activity_logs')) {
            query = query.replace(/WHERE/i, 'LEFT JOIN cases c ON d.case_id = c.case_id WHERE');
          } else if (query.includes('FROM task_activity_logs')) {
            query = query.replace(/WHERE/i, 'LEFT JOIN cases c ON t.case_id = c.case_id WHERE');
          } else if (query.includes('FROM time_entry_logs')) {
            query = query.replace(/WHERE/i, 'LEFT JOIN cases c ON te.case_id = c.case_id WHERE');
          } else if (query.includes('FROM case_note_logs')) {
            query = query.replace(/WHERE/i, 'LEFT JOIN cases c ON log.case_id = c.case_id WHERE');
          }
        }
        query += caseFilter.condition;
      } else if (caseFilter.condition) {
        // For case activity logs which already have cases joined
        query += caseFilter.condition;
      }
     
      return {
        query,
        params: caseFilter.params || []
      };
    };
 
    // Define all queries with their specific case ID columns (maintaining all existing fields)
    const queries = {
      events: generateQuery(`
        SELECT
          l.id::text AS id,
          l.event_id::text AS item_id,
          e.event_name as item_name,
          e.case_id::text AS case_id,
          l.action,
          l.field_name,
          l.old_value,
          l.new_value,
          l.uid,
          u.first_name,
          u.last_name,
          l.timestamp,
          'events' as type,
          NULL as description,
          NULL as filename,
          NULL as note_content,
          NULL as case_name,
          NULL as case_number
        FROM case_event_logs l
        LEFT JOIN case_events e ON l.event_id = e.id
        LEFT JOIN active_users u ON l.uid = u.uid
        WHERE 1=1 ${buildUserFilter('u')}
      `, { caseIdColumn: 'e.case_id' }),
     
      documents: generateQuery(`
        SELECT
          dal.document_id::text AS id,
          dal.document_id::text AS item_id,
          d.name AS item_name,
          d.case_id::text AS case_id,
          dal.action,
          NULL as field_name,
          NULL as old_value,
          NULL as new_value,
          dal.uid,
          au.first_name,
          au.last_name,
          dal.timestamp,
          'documents' as type,
          NULL as description,
          d.filename,
          NULL as note_content,
          NULL as case_name,
          NULL as case_number
        FROM document_activity_logs dal
        JOIN documents d ON dal.document_id = d.id
        JOIN active_users au ON dal.uid = au.uid
        WHERE 1=1 ${buildUserFilter('au')}
      `, { caseIdColumn: 'd.case_id' }),
     
      tasks: generateQuery(`
        SELECT
          tal.task_id::text AS id,
          tal.task_id::text AS item_id,
          t.task_name as item_name,
          t.case_id::text AS case_id,
          tal.action,
          tal.field_name,
          tal.old_value,
          tal.new_value,
          tal.uid,
          au.first_name,
          au.last_name,
          tal.timestamp,
          'tasks' as type,
          t.description,
          NULL as filename,
          NULL as note_content,
          NULL as case_name,
          NULL as case_number
        FROM task_activity_logs tal
        LEFT JOIN task_record t ON tal.task_id::integer = t.id
        LEFT JOIN active_users au ON tal.uid = au.uid
        WHERE tal.field_name != 'completed_at' ${buildUserFilter('au')}
      `, { caseIdColumn: 't.case_id' }),
     
      time_entries: generateQuery(`
        SELECT
          log.time_entry_id::text AS id,
          log.time_entry_id::text AS item_id,
          te.activity_name as item_name,
          te.case_id::text AS case_id,
          log.action,
          log.field_name,
          log.old_value,
          log.new_value,
          log.uid,
          au.first_name,
          au.last_name,
          log.timestamp,
          'time_entries' as type,
          te.description,
          NULL as filename,
          NULL as note_content,
          NULL as case_name,
          NULL as case_number
        FROM time_entry_logs log
        LEFT JOIN time_entries te ON log.time_entry_id = te.time_entry_id
        LEFT JOIN active_users au ON log.uid = au.uid
        WHERE 1=1 ${buildUserFilter('au')}
      `, { caseIdColumn: 'te.case_id' }),
     
      case_notes: generateQuery(`
        SELECT
          log.id::text AS id,
          log.note_id::text AS item_id,
          cn.subject AS item_name,
          log.case_id::text AS case_id,
          log.action,
          log.field_name,
          log.old_value,
          log.new_value,
          log.uid,
          au.first_name,
          au.last_name,
          log.timestamp,
          'case_notes' as type,
          NULL as description,
          NULL as filename,
          cn.note as note_content,
          c.name AS case_name,
          c.case_number
        FROM case_note_logs log
        JOIN case_notes_record cn ON log.note_id = cn.id
        LEFT JOIN cases c ON log.case_id = c.case_id
        LEFT JOIN active_users au ON log.uid = au.uid
        WHERE 1=1 ${buildUserFilter('au')}
      `, { caseIdColumn: 'log.case_id', joinCases: false }),
     
      cases: generateQuery(`
        SELECT
          log.id::text AS id,
          log.case_id::text AS item_id,
          c.name AS item_name,
          log.case_id::text AS case_id,
          log.action,
          log.field_name,
          log.old_value,
          log.new_value,
          log.uid,
          au.first_name,
          au.last_name,
          log.timestamp,
          'cases' as type,
          NULL as description,
          NULL as filename,
          NULL as note_content,
          c.name AS case_name,
          c.case_number
        FROM case_activity_logs log
        JOIN cases c ON log.case_id = c.case_id
        LEFT JOIN active_users au ON log.uid = au.uid
        WHERE 1=1 ${buildUserFilter('au')}
      `, { caseIdColumn: 'log.case_id', joinCases: false })
    };
 
    // Combine queries or use single tab query (unchanged)
    let query;
    let params = [];
 
    if (tab === 'all') {
      const allQueries = Object.values(queries).map(q => q.query);
      query = allQueries.join(' UNION ALL ');
      query = `SELECT * FROM (${query}) AS combined ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      params = Object.values(queries).reduce((acc, q) => [...acc, ...q.params], []);
      params.push(numericLimit, offset);
    } else {
      query = `${queries[tab].query} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      params = [...queries[tab].params, numericLimit, offset];
    }
 
    // Execute query and format results (unchanged)
    const [rows] = await db.promise().query(query, params);
 
    const formattedRows = rows.map(log => {
      if (log.type === 'tasks' && log.field_name === 'completed') {
        log.old_value = log.old_value == 1 ? 'Yes' : (log.old_value == 0 ? 'No' : log.old_value);
        log.new_value = log.new_value == 1 ? 'Yes' : (log.new_value == 0 ? 'No' : log.new_value);
      }
      return log;
    });
 
    res.json(formattedRows);
  } catch (err) {
    console.error("Error fetching activities:", err);
    res.status(500).json({ error: "Error fetching activities" });
  }
});
 
 
router.get('/time_entries/recent-activity1', async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT 
        log.*, 
        te.description AS time_entry_description, 
        te.entry_date, 
        te.rate, 
        te.flat_fee, 
        te.hours, 
        te.activity_name, 
        au.first_name, 
        au.last_name
      FROM time_entry_logs log
      LEFT JOIN time_entries te ON log.time_entry_id = te.time_entry_id
      LEFT JOIN active_users au ON log.uid = au.uid
      ORDER BY log.timestamp DESC
      LIMIT 50`
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No time entry logs found' });
    }

    res.json(rows);
  } catch (err) {
    console.error('Error fetching time entry logs:', err);
    res.status(500).json({ error: 'Failed to fetch time entry logs' });
  }
});
// POST /activity – create an activity record (example for a generic activity)
router.post("/activity", (req, res) => {
  const { activity_name } = req.body;
  const query = "INSERT INTO activity (activity_name) VALUES (?)";
  db.query(query, [activity_name], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId, activity_name });
  });
});

// GET /activity – get all activities
router.get("/activity", (req, res) => {
  db.query("SELECT * FROM activity", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json(results);
  });
});

// GET /activity/:id – get single activity
router.get("/activity/:id", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM activity WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ message: "Activity not found" });
    res.status(200).json(results[0]);
  });
});

// PUT /activity/:id – update an activity
router.put("/activity/:id", (req, res) => {
  const { id } = req.params;
  const { activity_name } = req.body;
  const query = "UPDATE activity SET activity_name = ? WHERE id = ?";
  db.query(query, [activity_name, id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!result.affectedRows) return res.status(404).json({ message: "Activity not found" });
    res.status(200).json({ id, activity_name });
  });
});

// DELETE /activity/:id – delete an activity
router.delete("/activity/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM activity WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!result.affectedRows) return res.status(404).json({ message: "Activity not found" });
    res.status(204).json();
  });
});

module.exports = router;