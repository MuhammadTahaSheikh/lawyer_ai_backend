// routes/tasks.js
const express = require("express");
const router = express.Router();
const db = require("../db");
 
// GET /tasks/filtered – fetch task statistics
router.get("/tasks/filtered", async (req, res) => {
  try {
    const dueTodayQuery = `SELECT COUNT(*) AS due_today FROM task_record WHERE due_date = CURDATE()`;
    const overDueQuery = `SELECT COUNT(*) AS over_due FROM task_record WHERE due_date < CURDATE() AND completed = 0`;
    const incompleteQuery = `SELECT COUNT(*) AS incomplete FROM task_record WHERE completed = 0`;
 
    const dueTodayPromise = new Promise((resolve, reject) => {
      db.query(dueTodayQuery, (err, result) => {
        if (err) reject(err);
        else resolve(result[0]?.due_today || 0);
      });
    });
    const overDuePromise = new Promise((resolve, reject) => {
      db.query(overDueQuery, (err, result) => {
        if (err) reject(err);
        else resolve(result[0]?.over_due || 0);
      });
    });
    const incompletePromise = new Promise((resolve, reject) => {
      db.query(incompleteQuery, (err, result) => {
        if (err) reject(err);
        else resolve(result[0]?.incomplete || 0);
      });
    });
    const [due_today, over_due, incomplete] = await Promise.all([dueTodayPromise, overDuePromise, incompletePromise]);
    res.json({ due_today, over_due, incomplete });
  } catch (err) {
    console.error("Error fetching task summary:", err);
    res.status(500).send("Error fetching task summary.");
  }
});
 
// GET /tasks – paginated tasks with optional search and sort
router.get("/tasks", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const assignedToUid = req.query.assignedTo; // Firebase UID
  const completionStatus = req.query.completionStatus;
  const dueDateRange = req.query.dueDateRange;
  const caseId = req.query.caseId;
  const dueTodayOnly = req.query.dueTodayOnly === "true";
const upcomingRange = req.query.upcomingRange;
 
  const sort = req.query.sort === "due_date ASC"
    ? "ISNULL(due_date), due_date ASC"
    : req.query.sort || "created_at DESC";
 
  const proceedWithStaffId = (assignedToStaffId) => {
    let conditions = [];
    let values = [];
 
    if (search) {
      conditions.push("task_name LIKE ?");
      values.push(`%${search}%`);
    }
 
    if (assignedToStaffId) {
      // Match if user is in either assigned_to OR staff_ids
      conditions.push("(FIND_IN_SET(?, t.assigned_to) OR FIND_IN_SET(?, t.staff_ids))");
      values.push(assignedToStaffId, assignedToStaffId);
    }
 
    if (completionStatus === "complete") {
      conditions.push("completed = 1");
    } else if (completionStatus === "incomplete") {
      conditions.push("completed = 0");
    }
 
    if (dueDateRange) {
      let dateCondition = "";
      switch (dueDateRange) {
        case "month_to_date":
          dateCondition = "due_date BETWEEN DATE_FORMAT(NOW(), '%Y-%m-01') AND NOW()";
          break;
        case "last_7_days":
          dateCondition = "due_date BETWEEN DATE_SUB(NOW(), INTERVAL 7 DAY) AND NOW()";
          break;
        case "last_30_days":
          dateCondition = "due_date BETWEEN DATE_SUB(NOW(), INTERVAL 30 DAY) AND NOW()";
          break;
        case "last_90_days":
          dateCondition = "due_date BETWEEN DATE_SUB(NOW(), INTERVAL 90 DAY) AND NOW()";
          break;
        case "last_year":
          dateCondition = "due_date BETWEEN DATE_SUB(NOW(), INTERVAL 1 YEAR) AND NOW()";
          break;
        case "year_to_date":
          dateCondition = "due_date BETWEEN DATE_FORMAT(NOW(), '%Y-01-01') AND NOW()";
          break;
        default:
          break;
      }
      if (dateCondition) {
        conditions.push(dateCondition);
      }
    }
if (upcomingRange) {
  let upcomingCondition = "";
  switch (upcomingRange) {
    case "7_days":
      upcomingCondition = "due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)";
      break;
    case "15_days":
      upcomingCondition = "due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 15 DAY)";
      break;
    case "1_month":
      upcomingCondition = "due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 MONTH)";
      break;
    case "3_months":
      upcomingCondition = "due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 MONTH)";
      break;
       case "all_upcoming":
      upcomingCondition = "due_date > CURDATE()";
      break;
    default:
      break;
  }
  if (upcomingCondition) {
    conditions.push(upcomingCondition);
  }
}
 
 
    if (caseId) {
      conditions.push("t.case_id = ?");
      values.push(caseId);
    }
 
    if (dueTodayOnly) {
      conditions.push("DATE(due_date) = CURDATE()");
    }
 
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
 
    const totalTasksQuery = `SELECT COUNT(*) AS totalTasks FROM task_record t ${whereClause}`;
    const paginatedTasksQuery = `
      SELECT t.*, c.name
      FROM task_record t
      LEFT JOIN cases c ON t.case_id = c.case_id
      ${whereClause}
      ORDER BY ${sort}
      LIMIT ? OFFSET ?
    `;
 
    const queryValues = dueTodayOnly ? values : [...values, limit, offset];
    const finalQuery = dueTodayOnly
      ? `
        SELECT t.*, c.name
        FROM task_record t
        LEFT JOIN cases c ON t.case_id = c.case_id
        ${whereClause}
        ORDER BY ${sort}`
      : paginatedTasksQuery;
 
    db.query(totalTasksQuery, values, (err, totalResults) => {
      if (err) {
        console.error("Error fetching total tasks:", err);
        return res.status(500).send("Error fetching total tasks.");
      }
 
      const totalTasks = totalResults[0]?.totalTasks || 0;
 
      db.query(finalQuery, queryValues, async (err, paginatedResults) => {
        if (err) {
          console.error("Error fetching tasks:", err);
          return res.status(500).send("Error fetching tasks.");
        }
 
        try {
          const [activeUsers] = await db.promise().query("SELECT staff_id, first_name, last_name FROM active_users");
          const [staffUsers] = await db.promise().query("SELECT staff_id, first_name, last_name FROM staff");
 
          const userMap = {};
          [...activeUsers, ...staffUsers].forEach(user => {
            userMap[user.staff_id] = `${user.first_name} ${user.last_name}`;
          });
 
          const formatDateToLocal = date => {
            if (!date) return null;
            const dt = new Date(date);
            return dt.toLocaleDateString('en-US');
          };
 
          paginatedResults.forEach(task => {
            let assignedIds = [];
            if (task.assigned_to) {
              assignedIds = task.assigned_to.split(',');
            } else if (task.staff_ids) {
              assignedIds = task.staff_ids.split(',');
            }
 
            task.assigned_to_name = assignedIds
              .map(id => userMap[parseInt(id)] || '')
              .filter(Boolean)
              .join(', ');
 
            if (task.assigned_by) {
              const assignedById = parseInt(task.assigned_by);
              task.assigned_by_name = userMap[assignedById] || '';
            }
 
            // Format the due_date in local time
            if (task.due_date) {
              task.due_date = formatDateToLocal(task.due_date);
            }
          });
 
        } catch (mapErr) {
          console.error("Error mapping assigned_to names:", mapErr);
        }
 
        res.json({ totalTasks, tasks: paginatedResults });
      });
    });
  };
 
  // 🔍 Convert Firebase UID → staff_id before filtering
  if (assignedToUid) {
   db.query("SELECT staff_id, type FROM active_users WHERE uid = ?", [assignedToUid], (err, result) => {
  if (err || !result.length) {
    console.error("UID to staff_id lookup failed:", err || "No match found");
    return res.json({ totalTasks: 0, tasks: [] });
  }
 
  const staffId = result[0].staff_id?.toString();
  const userType = result[0].type?.toLowerCase();
 
  if (userType === "admin") {
    proceedWithStaffId(null); // Admin sees all tasks
  } else {
    proceedWithStaffId(staffId); // Staff see only their tasks
  }
});
 
  } else {
    proceedWithStaffId(null);
  }
});
 
 
 
 
 
// GET /tasks/activity – get task activity logs
router.get("/tasks/activity", async (req, res) => {
  const query = `
    SELECT tal.uid, au.first_name, au.last_name, tal.task_id, t.task_name, t.description, t.case_id,
           tal.action, tal.timestamp, tal.field_name, tal.old_value, tal.new_value
    FROM task_activity_logs tal
    JOIN tasks t ON tal.task_id = t.task_id
    JOIN active_users au ON tal.uid = au.uid
    ORDER BY tal.timestamp DESC
  `;
  try {
    const [rows] = await db.promise().query(query);
    res.json({ activities: rows });
  } catch (err) {
    console.error("Error fetching task activity logs:", err);
    res.status(500).json({ error: "Failed to fetch task activity logs" });
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
// GET /tasks/by-case/:case_id – tasks for a given case
// router.get("/tasks/by-case/:case_id", (req, res) => {
//   const caseId = req.params.case_id;
//   const page = parseInt(req.query.page) || 1;
//   const limit = 20;
//   const offset = (page - 1) * limit;
//   const search = req.query.search || "";
//   const sort = req.query.sort || "due_date ASC";
//   let conditions = ["t.case_id = ?"];
//   let values = [caseId];
//   if (search) {
//     conditions.push("t.task_name LIKE ?");
//     values.push(`%${search}%`);
//   }
//   const whereClause = `WHERE ${conditions.join(" AND ")}`;
//   const totalTasksQuery = `SELECT COUNT(*) AS totalTasks FROM tasks t ${whereClause}`;
//   const paginatedTasksQuery = `
//     SELECT t.*, c.name
//     FROM tasks t
//     LEFT JOIN cases c ON t.case_id = c.case_id
//     ${whereClause}
//     ORDER BY ${sort}
//     LIMIT ? OFFSET ?
//   `;
//   db.query(totalTasksQuery, values, (err, totalResults) => {
//     if (err) {
//       console.error("Error fetching total tasks for case_id:", err);
//       return res.status(500).send("Error fetching total tasks for case_id.");
//     }
//     const totalTasks = totalResults[0]?.totalTasks || 0;
//     db.query(paginatedTasksQuery, [...values, limit, offset], (err, paginatedResults) => {
//       if (err) {
//         console.error("Error fetching paginated tasks for case_id:", err);
//         return res.status(500).send("Error fetching paginated tasks for case_id.");
//       }
//       res.json({ case_id: caseId, totalTasks, tasks: paginatedResults });
//     });
//   });
// });
// router.get("/tasks/by-case/:case_id", (req, res) => {
//   const caseId = req.params.case_id;
//   const page = parseInt(req.query.page) || 1;
//   const limit = 20;
//   const offset = (page - 1) * limit;
//   const search = req.query.search || "";
//   const assignedTo = req.query.assignedTo;
//   const completionStatus = req.query.completionStatus;
//   const dueDateRange = req.query.dueDateRange;
//   const sort = req.query.sort || "due_date ASC";
 
//   let conditions = ["t.case_id = ?"];
//   let values = [caseId];
 
//   if (search) {
//     conditions.push("t.task_name LIKE ?");
//     values.push(`%${search}%`);
//   }
 
//   if (assignedTo && assignedTo !== "all") {
//     conditions.push("FIND_IN_SET(?, t.assigned_to)");
//     values.push(assignedTo);
//   }
 
//   if (completionStatus === "complete") {
//     conditions.push("t.completed = 1");
//   } else if (completionStatus === "incomplete") {
//     conditions.push("t.completed = 0");
//   }
 
//   if (dueDateRange && dueDateRange !== "all_time") {
//     const now = new Date();
//     let dateCondition = "";
   
//     switch (dueDateRange) {
//       case "month_to_date":
//         dateCondition = "t.due_date BETWEEN DATE_FORMAT(NOW(), '%Y-%m-01') AND NOW()";
//         break;
//       case "last_7_days":
//         dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 7 DAY) AND NOW()";
//         break;
//       case "last_30_days":
//         dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 30 DAY) AND NOW()";
//         break;
//       case "last_90_days":
//         dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 90 DAY) AND NOW()";
//         break;
//       case "last_year":
//         dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 1 YEAR) AND NOW()";
//         break;
//       case "year_to_date":
//         dateCondition = "t.due_date BETWEEN DATE_FORMAT(NOW(), '%Y-01-01') AND NOW()";
//         break;
//       default:
//         break;
//     }
   
//     if (dateCondition) {
//       conditions.push(dateCondition);
//     }
//   }
 
//   const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
//   const totalTasksQuery = `SELECT COUNT(*) AS totalTasks FROM tasks t ${whereClause}`;
 
//   const paginatedTasksQuery = `
//     SELECT t.*, c.name, CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
//     FROM tasks t
//     LEFT JOIN cases c ON t.case_id = c.case_id
//     LEFT JOIN active_users u ON t.assigned_to = u.staff_id
//     ${whereClause}
//     ORDER BY ${sort}
//     LIMIT ? OFFSET ?
//   `;
 
//   db.query(totalTasksQuery, values, (err, totalResults) => {
//     if (err) {
//       console.error("Error fetching total tasks for case_id:", err);
//       return res.status(500).send("Error fetching total tasks for case_id.");
//     }
   
//     const totalTasks = totalResults[0]?.totalTasks || 0;
   
//     db.query(paginatedTasksQuery, [...values, limit, offset], async (err, paginatedResults) => {
//       if (err) {
//         console.error("Error fetching paginated tasks for case_id:", err);
//         return res.status(500).send("Error fetching paginated tasks for case_id.");
//       }
 
//       try {
//         const [users] = await db.promise().query("SELECT staff_id, first_name, last_name FROM active_users");
//         const userMap = {};
//         users.forEach(user => {
//           userMap[user.staff_id] = `${user.first_name} ${user.last_name}`;
//         });
 
//         paginatedResults.forEach(task => {
//           if (task.assigned_to) {
//             const ids = task.assigned_to.split(',');
//             task.assigned_to_name = ids.map(id => userMap[parseInt(id)] || '').filter(Boolean).join(', ');
//           }
//         });
//       } catch (mapErr) {
//         console.error("Error mapping assigned_to names:", mapErr);
//       }
 
//       res.json({ case_id: caseId, totalTasks, tasks: paginatedResults });
//     });
//   });
// });
router.get("/tasks/by-case/:case_id", (req, res) => {
  const caseId = req.params.case_id;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const assignedTo = req.query.assignedTo;
  const completionStatus = req.query.completionStatus;
  const dueDateRange = req.query.dueDateRange;
  const sort = req.query.sort || "due_date ASC";
 
  let conditions = ["t.case_id = ?"];
  let values = [caseId];
 
  if (search) {
    conditions.push("t.task_name LIKE ?");
    values.push(`%${search}%`);
  }
  // if (assignedTo) {
  //   // Match if user is in either assigned_to OR staff_ids
  //   conditions.push("(FIND_IN_SET(?, t.assigned_to) OR FIND_IN_SET(?, t.staff_ids))");
  //   values.push(assignedTo, assignedTo);
  // }
  if (assignedTo && assignedTo !== "all") {
    conditions.push("(FIND_IN_SET(?, t.assigned_to) OR FIND_IN_SET(?, t.staff_ids))");
    values.push(assignedTo, assignedTo);
  }
 
  if (completionStatus === "complete") {
    conditions.push("t.completed = 1");
  } else if (completionStatus === "incomplete") {
    conditions.push("t.completed = 0");
  }
 
  if (dueDateRange && dueDateRange !== "all_time") {
    let dateCondition = "";
 
    switch (dueDateRange) {
      case "month_to_date":
        dateCondition = "t.due_date BETWEEN DATE_FORMAT(NOW(), '%Y-%m-01') AND NOW()";
        break;
      case "last_7_days":
        dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 7 DAY) AND NOW()";
        break;
      case "last_30_days":
        dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 30 DAY) AND NOW()";
        break;
      case "last_90_days":
        dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 90 DAY) AND NOW()";
        break;
      case "last_year":
        dateCondition = "t.due_date BETWEEN DATE_SUB(NOW(), INTERVAL 1 YEAR) AND NOW()";
        break;
      case "year_to_date":
        dateCondition = "t.due_date BETWEEN DATE_FORMAT(NOW(), '%Y-01-01') AND NOW()";
        break;
      default:
        break;
    }
 
    if (dateCondition) {
      conditions.push(dateCondition);
    }
  }
 
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalTasksQuery = `SELECT COUNT(*) AS totalTasks FROM task_record t ${whereClause}`;
 
  const paginatedTasksQuery = `
SELECT t.*, c.name
    FROM task_record t
    LEFT JOIN cases c ON t.case_id = c.case_id
   
    ${whereClause}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `;
 
  db.query(totalTasksQuery, values, (err, totalResults) => {
    if (err) {
      console.error("Error fetching total tasks for case_id:", err);
      return res.status(500).send("Error fetching total tasks for case_id.");
    }
 
    const totalTasks = totalResults[0]?.totalTasks || 0;
 
    db.query(paginatedTasksQuery, [...values, limit, offset], async (err, paginatedResults) => {
      if (err) {
        console.error("Error fetching paginated tasks for case_id:", err);
        return res.status(500).send("Error fetching paginated tasks for case_id.");
      }
 
      try {
        const [users] = await db.promise().query("SELECT staff_id, first_name, last_name FROM active_users");
        const userMap = {};
        users.forEach(user => {
          userMap[user.staff_id] = `${user.first_name} ${user.last_name}`;
        });
 
        try {
          const [activeUsers] = await db.promise().query("SELECT staff_id, first_name, last_name FROM active_users");
          const [staffUsers] = await db.promise().query("SELECT staff_id, first_name, last_name FROM staff");
       
          // Combine both sources into one map
          const userMap = {};
          [...activeUsers, ...staffUsers].forEach(user => {
            userMap[user.staff_id] = `${user.first_name} ${user.last_name}`;
          });
       
          paginatedResults.forEach(task => {
            if (task.staff_ids) {
              const ids = task.staff_ids.split(',');
              task.assigned_to_name = ids
                .map(id => userMap[parseInt(id)] || '')
                .filter(Boolean)
                .join(', ');
            }
          });
        } catch (mapErr) {
          console.error("Error mapping assigned_to names:", mapErr);
        }
       
      } catch (mapErr) {
        console.error("Error mapping assigned_to names:", mapErr);
      }
 
      res.json({ case_id: caseId, totalTasks, tasks: paginatedResults });
    });
  });
});
 
// GET /tasks/:id – fetch single task by task_id
router.get("/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  db.query("SELECT * FROM tasks WHERE task_id = ?", [taskId], (err, result) => {
    if (err) return res.status(500).send("Error fetching task.");
    if (!result.length) return res.status(404).send("Task not found.");
    res.json(result[0]);
  });
});
 
// POST /tasks – create new task (includes generating task_id)
function generateNextTaskId() {
  return new Promise((resolve, reject) => {
    db.query("SELECT task_id FROM tasks ORDER BY task_id DESC LIMIT 1", (err, result) => {
      if (err) {
        console.error("Error fetching last task_id:", err);
        return reject(err);
      }
 
      let nextTaskId = "000001";
      if (result.length > 0) {
        const lastTaskId = result[0].task_id;
        const numericPart = String(lastTaskId).replace(/\D/g, '');
        if (numericPart && !isNaN(numericPart)) {
          const incremented = parseInt(numericPart, 10) + 1;
          nextTaskId = incremented.toString().padStart(6, '0');
        } else {
          console.warn("Invalid task_id format:", lastTaskId);
        }
      }
 
      resolve(nextTaskId);
    });
  });
}
 
 
router.post("/tasks", async (req, res) => {
let { task_name, description, priority, due_date, completed, case_id, assigned_to, assigned_to_name } = req.body;
 
// Convert empty due_date to null
if (due_date === "") {
  due_date = null;
}
  const userUid = req.headers['x-user-uid'];
  if (!userUid) return res.status(401).json({ error: "User UID missing in request headers" });
 
  try {
    const assignedToValue = Array.isArray(assigned_to) ? assigned_to.join(',') : assigned_to;
    const assignedToNameValue = Array.isArray(assigned_to_name) ? assigned_to_name.join(', ') : assigned_to_name;
 
    const insertQuery = `
      INSERT INTO task_record (task_name, description, priority, due_date, completed, case_id, assigned_to, assigned_to_name, uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
 
    const [result] = await db.promise().query(insertQuery,
      [task_name, description, priority, due_date, completed, case_id, assignedToValue, assignedToNameValue, userUid]);
 
    const task_id = result.insertId;
 
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedTimestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
 
    await db.promise().query(
      "INSERT INTO task_activity_logs (uid, task_id, action, timestamp) VALUES (?, ?, 'create', ?)",
      [userUid, task_id, formattedTimestamp]
    );
 
    res.status(201).json({ task_id, ...req.body });
  } catch (err) {
    console.error("Task creation failed:", err);
    res.status(500).send("Error creating task.");
  }
});
 
 
 
// PUT /tasks/:id – update a task
router.put("/tasks/:id", async (req, res) => {
  const taskId = req.params.id;
  const updatedFields = req.body;
  if (updatedFields.due_date === "") {
  updatedFields.due_date = null;
}
 
  const userUid = req.headers['x-user-uid'];
  if (!userUid) return res.status(401).json({ error: "User UID missing in request headers" });
 
  // Convert arrays to strings for DB storage
  if (Array.isArray(updatedFields.assigned_to)) {
    updatedFields.assigned_to = updatedFields.assigned_to.join(',');
  }
  if (Array.isArray(updatedFields.assigned_to_name)) {
    updatedFields.assigned_to_name = updatedFields.assigned_to_name.join(', ');
  }
 
  updatedFields.updated_at = new Date();
 
  try {
    const [existingTasks] = await db.promise().query("SELECT * FROM task_record WHERE id = ?", [taskId]);
    if (!existingTasks.length) return res.status(404).send("Task not found.");
    const existingTask = existingTasks[0];
 
    // Handle completed_at
    if (updatedFields.completed === 1 || updatedFields.completed === true) {
      if (!existingTask.completed_at) {
        updatedFields.completed_at = new Date();
      }
    } else if (updatedFields.completed === 0 || updatedFields.completed === false) {
      updatedFields.completed_at = null;
    }
 
    await db.promise().query("UPDATE task_record SET ? WHERE id = ?", [updatedFields, taskId]);
 
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    const [datePart, timePart] = timestamp.split(', ');
    const [month, day, year] = datePart.split('/');
    const formattedTimestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
 
    for (const key in updatedFields) {
      if (['updated_at', 'case_id', 'assigned_to'].includes(key)) continue;
      if (existingTask[key] != updatedFields[key]) {
        await db.promise().query(
          `INSERT INTO task_activity_logs (uid, task_id, action, timestamp, field_name, old_value, new_value)
           VALUES (?, ?, 'update', ?, ?, ?, ?)`,
          [userUid, taskId, formattedTimestamp, key, existingTask[key], updatedFields[key]]
        );
      }
    }
 
    res.send("Task updated successfully.");
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).send("Error updating task.");
  }
});
 
 
 
 
// DELETE /tasks/:id – delete a task
router.delete("/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  db.query("DELETE FROM task_record WHERE id = ?", [taskId], (err, result) => {
    if (err) return res.status(500).send("Error deleting task.");
    if (!result.affectedRows) return res.status(404).send("Task not found.");
    res.send("Task deleted successfully.");
  });
});
 
// GET /tasksCaseInformation/:caseId – get tasks details with stats for a case
router.get("/tasksCaseInformation/:caseId", (req, res) => {
  const caseId = req.params.caseId;
  db.query("SELECT * FROM task_record WHERE case_id = ?", [caseId], (err, results) => {
    if (err) return res.status(500).json({ error: "Error fetching tasks." });
    if (!results.length) return res.status(404).json({ message: "No tasks found." });
    const today = new Date();
    const completedTasks = results.filter(task => task.completed === 1);
    const overdueTasks = results.filter(task => new Date(task.due_date) < today && task.completed === 0);
    const upcomingTasks = results.filter(task => new Date(task.due_date) >= today && task.completed === 0);
    res.json({
      tasks: results,
      totalTasks: results.length,
      completedTasks: completedTasks.length,
      overdueTasks,
      upcomingTasks
    });
  });
});
 
module.exports = router;