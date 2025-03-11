const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const db = mysql.createConnection({
  host: "casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com",
  user: "admin",
  password: "GFiL*elWuqU5Csl1",
  database: "casesdb",
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }
  console.log("Connected to the database.");
});

// ------------------- CASES ENDPOINTS -------------------

// API: Fetch paginated, filtered, and sorted cases
app.get("/cases", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const search = req.query.search || "";
  const practiceArea = req.query.practice_area || "";
  const date = req.query.date || "";
  // Sorting by converting opened_date (stored as mm/dd/yy) into a date
  const sort = req.query.sort || "STR_TO_DATE(opened_date, '%m/%d/%y') DESC";

  let conditions = [];
  let values = [];

  if (search) {
    conditions.push("(name LIKE ? OR case_number LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
  if (practiceArea) {
    conditions.push("practice_area = ?");
    values.push(practiceArea);
  }
  if (date) {
    conditions.push("DATE(STR_TO_DATE(opened_date, '%Y-%m-%d')) = ?");
    values.push(date);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalCasesQuery = `SELECT COUNT(*) AS totalCases FROM cases ${whereClause}`;
  const paginatedCasesQuery = `
    SELECT case_id, name, case_number, practice_area, assigned_attorney, case_stage, opened_date 
    FROM cases 
    ${whereClause} 
    ORDER BY ${sort} 
    LIMIT ? OFFSET ?
  `;

  db.query(totalCasesQuery, values, (err, totalResults) => {
    if (err) {
      console.error("Error fetching total cases:", err);
      return res.status(500).send("Error fetching total cases.");
    }
    const totalCases = totalResults[0]?.totalCases || 0;
    db.query(paginatedCasesQuery, [...values, limit, offset], (err, paginatedResults) => {
      if (err) {
        console.error("Error fetching cases:", err);
        return res.status(500).send("Error fetching cases.");
      }
      res.json({
        totalCases,
        cases: paginatedResults,
      });
    });
  });
});

// API: Add a new case and update the associated contact with the new case_id
// This endpoint expects the JSON payload to have all keys that match your cases table columns.
// Additionally, a "contact_id" key must be provided to update the related contact.
app.post("/cases", (req, res) => {
  // Extract contact_id and all other fields from the request body.
  const { contact_id, ...caseData } = req.body;
  // Get an array of column names (which should match your database exactly)
  const columns = Object.keys(caseData);
  // Build an array of corresponding values; if a key is missing, default to null.
  const values = columns.map((col) =>
    req.body[col] !== undefined ? req.body[col] : null
  );
  // Build the placeholders string (e.g., "?, ?, ?, ...")
  const placeholders = columns.map(() => "?").join(", ");
  // Construct the INSERT query
  const insertCaseQuery = `INSERT INTO cases (${columns.join(
    ", "
  )}) VALUES (${placeholders})`;

  db.query(insertCaseQuery, values, (err, result) => {
    if (err) {
      console.error("Error inserting case:", err.sqlMessage || err);
      return res
        .status(500)
        .send("Error creating case: " + (err.sqlMessage || err.message));
    }
    const newCaseId = result.insertId;
    // Update the contact's case_id field. If it already has a value, append the new case_id.
    const updateContactQuery = `
      UPDATE contacts
      SET case_id = IF(case_id IS NULL OR case_id = '', ?, CONCAT(case_id, ',', ?))
      WHERE contact_id = ?
    `;
    db.query(
      updateContactQuery,
      [newCaseId, newCaseId, contact_id],
      (err, updateResult) => {
        if (err) {
          console.error("Error updating contact with new case_id:", err);
          return res
            .status(500)
            .send("Case created, but failed to update contact.");
        }
        res
          .status(201)
          .send({ case_id: newCaseId, message: "Case created successfully." });
      }
    );
  });
});

// ------------------- CONTACTS ENDPOINTS -------------------

// Fetch paginated, filtered, and sorted contacts
app.get("/contacts", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const sort = req.query.sort || "created_date DESC";
  let conditions = [];
  let values = [];
  if (search) {
    conditions.push("(first_name LIKE ? OR last_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalContactsQuery = `SELECT COUNT(*) AS totalContacts FROM contacts ${whereClause}`;
  const paginatedContactsQuery = `
    SELECT contact_id, first_name, last_name, case_name, created_date, created_by 
    FROM contacts 
    ${whereClause} 
    ORDER BY ${sort} 
    LIMIT ? OFFSET ?
  `;
  db.query(totalContactsQuery, values, (err, totalResults) => {
    if (err) {
      console.error("Error fetching total contacts:", err);
      return res.status(500).send("Error fetching total contacts.");
    }
    const totalContacts = totalResults[0]?.totalContacts || 0;
    db.query(paginatedContactsQuery, [...values, limit, offset], (err, paginatedResults) => {
      if (err) {
        console.error("Error fetching contacts:", err);
        return res.status(500).send("Error fetching contacts.");
      }
      res.json({
        totalContacts,
        contacts: paginatedResults,
      });
    });
  });
});

// Fetch a specific contact by ID
app.get("/contacts/:id", (req, res) => {
  const contactId = req.params.id;
  const contactQuery = "SELECT * FROM contacts WHERE contact_id = ?";
  db.query(contactQuery, [contactId], (err, result) => {
    if (err) {
      console.error("Error fetching contact:", err);
      return res.status(500).send("Error fetching contact.");
    }
    if (result.length === 0) {
      return res.status(404).send("Contact not found.");
    }
    res.json(result[0]);
  });
});

// Add a new contact
app.post("/contacts", (req, res) => {
  const {
    first_name,
    middle_name,
    last_name,
    company,
    job_title,
    home_street,
    home_street_2,
    home_city,
    home_state,
    home_postal_code,
    home_country,
    home_fax,
    work_phone,
    home_phone,
    mobile_phone,
    contact_group,
    email,
    birthday,
    private_notes,
    contact_notes,
    case_name,
    case_id,
    preferred_language,
    insurance_company,
    insured_property,
    brief_description_of_the_loss,
    mailing_address_if_different_from_above,
    have_the_claim_been_reported,
    policy_number,
    claim_number,
    date_of_loss,
    public_adjuster_if_applicable,
    created_date,
    created_by,
  } = req.body;

  const finalCreatedBy =
    created_by !== undefined && created_by !== null && created_by !== ""
      ? created_by
      : "admin";

  const insertQuery = `
    INSERT INTO contacts (
      first_name,
      middle_name,
      last_name,
      company,
      job_title,
      home_street,
      home_street_2,
      home_city,
      home_state,
      home_postal_code,
      home_country,
      home_fax,
      work_phone,
      home_phone,
      mobile_phone,
      contact_group,
      email,
      birthday,
      private_notes,
      contact_notes,
      case_name,
      case_id,
      preferred_language,
      insurance_company,
      insured_property,
      brief_description_of_the_loss,
      mailing_address_if_different_from_above,
      have_the_claim_been_reported,
      policy_number,
      claim_number,
      date_of_loss,
      public_adjuster_if_applicable,
      created_date,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    first_name,
    middle_name,
    last_name,
    company,
    job_title,
    home_street,
    home_street_2,
    home_city,
    home_state,
    home_postal_code,
    home_country,
    home_fax,
    work_phone,
    home_phone,
    mobile_phone,
    contact_group,
    email,
    birthday,
    private_notes,
    contact_notes,
    case_name,
    case_id,
    preferred_language,
    insurance_company,
    insured_property,
    brief_description_of_the_loss,
    mailing_address_if_different_from_above,
    have_the_claim_been_reported,
    policy_number,
    claim_number,
    date_of_loss,
    public_adjuster_if_applicable,
    created_date,
    finalCreatedBy,
  ];
  console.log("Insert Query:", insertQuery);
  console.log("Values count:", values.length);
  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Error adding contact:", err.sqlMessage || err);
      return res
        .status(500)
        .send("Error adding contact: " + (err.sqlMessage || err.message));
    }
    res.status(201).send({ id: result.insertId, ...req.body });
  });
});

// Update a contact by ID
app.put("/contacts/:id", (req, res) => {
  const contactId = req.params.id;
  const updatedFields = req.body;
  const updateQuery = "UPDATE contacts SET ? WHERE contact_id = ?";
  db.query(updateQuery, [updatedFields, contactId], (err, result) => {
    if (err) {
      console.error("Error updating contact:", err);
      return res.status(500).send("Error updating contact.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Contact not found.");
    }
    res.send("Contact updated successfully.");
  });
});

// Delete a contact by ID
app.delete("/contacts/:id", (req, res) => {
  const contactId = req.params.id;
  const deleteQuery = "DELETE FROM contacts WHERE contact_id = ?";
  db.query(deleteQuery, [contactId], (err, result) => {
    if (err) {
      console.error("Error deleting contact:", err);
      return res.status(500).send("Error deleting contact.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Contact not found.");
    }
    res.send("Contact deleted successfully.");
  });
});

// ------------------- CASE DETAILS & EVENTS -------------------

// Fetch a specific case by ID, including notes and events
app.get("/cases/:id", (req, res) => {
  const caseId = req.params.id;
  const caseQuery = "SELECT * FROM cases WHERE case_id = ?";
  const eventsQuery = `
    SELECT id, case_name, event_name, event_description, start_event, end_event 
    FROM case_events 
    WHERE case_id = ? 
    ORDER BY start_event ASC
  `;
  const notesQuery = `
    SELECT subject, note, date 
    FROM case_notes 
    WHERE case_id = ? 
    ORDER BY STR_TO_DATE(date, '%m/%d/%Y') DESC
  `;
  db.query(caseQuery, [caseId], (err, caseResult) => {
    if (err) {
      console.error("Error fetching case details:", err);
      return res.status(500).send("Error fetching case details.");
    }
    if (caseResult.length === 0) {
      return res.status(404).send("Case not found.");
    }
    const caseData = caseResult[0];
    db.query(eventsQuery, [caseId], (err, eventsResult) => {
      if (err) {
        console.error("Error fetching case events:", err);
        return res.status(500).send("Error fetching case events.");
      }
      db.query(notesQuery, [caseId], (err, notesResult) => {
        if (err) {
          console.error("Error fetching case notes:", err);
          return res.status(500).send("Error fetching case notes.");
        }
        res.json({
          ...caseData,
          events: eventsResult,
          notes: notesResult,
        });
      });
    });
  });
});

// Update a specific event by ID
app.put("/events/:id", (req, res) => {
  const eventId = req.params.id;
  const { event_name, event_description, start_event, end_event } = req.body;
  const updateQuery = `
    UPDATE case_events
    SET event_name = ?, event_description = ?, start_event = ?, end_event = ?
    WHERE id = ?
  `;
  db.query(
    updateQuery,
    [event_name, event_description, start_event, end_event, eventId],
    (err, result) => {
      if (err) {
        console.error("Error updating event:", err);
        return res.status(500).send("Error updating event.");
      }
      if (result.affectedRows === 0) {
        return res.status(404).send("Event not found.");
      }
      res.send("Event updated successfully.");
    }
  );
});

// Delete a specific event by ID
app.delete("/events/:id", (req, res) => {
  const eventId = req.params.id;
  const deleteQuery = "DELETE FROM case_events WHERE id = ?";
  db.query(deleteQuery, [eventId], (err, result) => {
    if (err) {
      console.error("Error deleting event:", err);
      return res.status(500).send("Error deleting event.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Event not found.");
    }
    res.send("Event deleted successfully.");
  });
});

// Add a new event
app.post("/events", (req, res) => {
  const { case_id, event_name, event_description, start_event, end_event } = req.body;
  if (!case_id || !event_name || !start_event || !end_event) {
    return res.status(400).send("Missing required fields.");
  }
  const insertQuery = `
    INSERT INTO case_events (case_id, event_name, event_description, start_event, end_event)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(
    insertQuery,
    [case_id, event_name, event_description, start_event, end_event],
    (err, result) => {
      if (err) {
        console.error("Error adding event:", err);
        return res.status(500).send("Error adding event.");
      }
      res.status(201).send({ id: result.insertId, ...req.body });
    }
  );
});

// Fetch associated cases by contact ID
app.get("/contacts/:id/cases", (req, res) => {
  const contactId = req.params.id;
  const contactQuery = "SELECT case_id FROM contacts WHERE contact_id = ?";
  db.query(contactQuery, [contactId], (err, contactResult) => {
    if (err) {
      console.error("Error fetching contact's case IDs:", err);
      return res.status(500).send("Error fetching contact's case IDs.");
    }
    if (contactResult.length === 0 || !contactResult[0].case_id) {
      return res.status(404).send("No associated cases found for this contact.");
    }
    const caseIds = contactResult[0].case_id.split(",").map((id) => id.trim());
    const casesQuery = `
      SELECT case_id, name AS case_name
      FROM cases
      WHERE case_id IN (?)
    `;
    db.query(casesQuery, [caseIds], (err, casesResult) => {
      if (err) {
        console.error("Error fetching associated cases:", err);
        return res.status(500).send("Error fetching associated cases.");
      }
      res.json(casesResult);
    });
  });
});

// Fetch all events for the calendar
app.get("/events", (req, res) => {
  const eventsQuery = `
    SELECT 
      case_events.id, 
      case_events.event_name, 
      case_events.event_description, 
      case_events.start_event, 
      case_events.end_event, 
      cases.name AS case_name 
    FROM case_events
    LEFT JOIN cases ON case_events.case_id = cases.case_id
    ORDER BY case_events.start_event ASC
  `;
  db.query(eventsQuery, (err, results) => {
    if (err) {
      console.error("Error fetching events:", err);
      return res.status(500).send("Error fetching events.");
    }
    const formattedEvents = results.map((event) => {
      const start = event.start_event ? new Date(event.start_event) : null;
      const end = event.end_event ? new Date(event.end_event) : null;
      return {
        id: event.id,
        title: event.event_name || "Unnamed Event",
        description: event.event_description || "No description available",
        start: start,
        end: end,
        case_name: event.case_name || "No associated case",
      };
    });
    res.json(formattedEvents);
  });
});

// ------------------- CASE NOTES ENDPOINTS -------------------

// Get notes for a specific case (expects a query parameter ?case_id=xxx)
app.get("/case_notes", (req, res) => {
  const caseId = req.query.case_id;
  if (!caseId) {
    return res.status(400).send("Missing required query parameter: case_id");
  }
  const query = "SELECT * FROM case_notes WHERE case_id = ? ORDER BY STR_TO_DATE(date, '%m/%d/%Y') DESC";
  db.query(query, [caseId], (err, rows) => {
    if (err) {
      console.error("Error fetching notes:", err);
      return res.status(500).send("Error fetching notes: " + (err.sqlMessage || err.message));
    }
    res.json(rows);
  });
});

// Add a new note
app.post("/case_notes", (req, res) => {
  const { case_id, subject, note, date } = req.body;
  if (!case_id || !subject || !note) {
    return res.status(400).send("Missing required fields: case_id, subject, or note");
  }
  // Use provided date or default to today's date (formatted as YYYY-MM-DD)
  const noteDate = date || new Date().toISOString().slice(0, 10);
  const insertQuery = "INSERT INTO case_notes (case_id, subject, note, date) VALUES (?, ?, ?, ?)";
  db.query(insertQuery, [case_id, subject, note, noteDate], (err, result) => {
    if (err) {
      console.error("Error inserting note:", err);
      return res.status(500).send("Error creating note: " + (err.sqlMessage || err.message));
    }
    const newNoteId = result.insertId;
    // Return the newly created note
    db.query("SELECT * FROM case_notes WHERE id = ?", [newNoteId], (err, rows) => {
      if (err) {
        console.error("Error fetching new note:", err);
        return res.status(500).send("Error fetching new note.");
      }
      res.status(201).json(rows[0]);
    });
  });
});

// Update an existing note
app.put("/case_notes/:id", (req, res) => {
  const noteId = req.params.id;
  const { subject, note, date } = req.body;
  if (!subject || !note) {
    return res.status(400).send("Missing required fields: subject or note");
  }
  const noteDate = date || new Date().toISOString().slice(0, 10);
  const updateQuery = "UPDATE case_notes SET subject = ?, note = ?, date = ? WHERE id = ?";
  db.query(updateQuery, [subject, note, noteDate, noteId], (err, result) => {
    if (err) {
      console.error("Error updating note:", err);
      return res.status(500).send("Error updating note: " + (err.sqlMessage || err.message));
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Note not found.");
    }
    // Return the updated note
    db.query("SELECT * FROM case_notes WHERE id = ?", [noteId], (err, rows) => {
      if (err) {
        console.error("Error fetching updated note:", err);
        return res.status(500).send("Error fetching updated note.");
      }
      res.json(rows[0]);
    });
  });
});

// Delete a note
app.delete("/case_notes/:id", (req, res) => {
  const noteId = req.params.id;
  const deleteQuery = "DELETE FROM case_notes WHERE id = ?";
  db.query(deleteQuery, [noteId], (err, result) => {
    if (err) {
      console.error("Error deleting note:", err);
      return res.status(500).send("Error deleting note: " + (err.sqlMessage || err.message));
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Note not found.");
    }
    res.send("Note deleted successfully.");
  });
});



// ------------------- TASKS -------------------

// GET: Fetch tasks with pagination, filtering, and sorting
app.get("/tasks", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const search = req.query.search || "";
  const sort = req.query.sort || "due_date ASC";

  let conditions = [];
  let values = [];

  if (search) {
    conditions.push("(task_name LIKE ? OR description LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalTasksQuery = `SELECT COUNT(*) AS totalTasks FROM tasks ${whereClause}`;
  const paginatedTasksQuery = `
    SELECT * FROM tasks 
    ${whereClause} 
    ORDER BY ${sort} 
    LIMIT ? OFFSET ?
  `;

  db.query(totalTasksQuery, values, (err, totalResults) => {
    if (err) {
      console.error("Error fetching total tasks:", err);
      return res.status(500).send("Error fetching total tasks.");
    }

    const totalTasks = totalResults[0]?.totalTasks || 0;

    db.query(paginatedTasksQuery, [...values, limit, offset], (err, paginatedResults) => {
      if (err) {
        console.error("Error fetching tasks:", err);
        return res.status(500).send("Error fetching tasks.");
      }

      res.json({
        totalTasks,
        tasks: paginatedResults,
      });
    });
  });
});

// GET: Fetch a specific task by ID
app.get("/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  db.query("SELECT * FROM tasks WHERE task_id = ?", [taskId], (err, result) => {
    if (err) return res.status(500).send("Error fetching task.");
    if (result.length === 0) return res.status(404).send("Task not found.");
    res.json(result[0]);
  });
});

// Helper function to generate the next task_id
function generateNextTaskId() {
  return new Promise((resolve, reject) => {
    const query = 'SELECT task_id FROM tasks ORDER BY task_id DESC LIMIT 1'; // Get the latest task_id
    db.query(query, (err, result) => {
      if (err) return reject(err);
      
      let nextTaskId = '9000000'; // Default if no tasks exist yet
      if (result.length > 0) {
        // Get the numeric part of the last task_id and increment it
        const lastTaskId = result[0].task_id;
        const numericPart = parseInt(lastTaskId, 10);
        nextTaskId = (numericPart + 1).toString();
      }
      
      resolve(nextTaskId);
    });
  });
}

// POST: Create a new task (now including uid)
app.post("/tasks", async (req, res) => {
  // Expecting uid to be provided in the request body along with other fields
  const { task_name, description, priority, due_date, completed, case_id, uid } = req.body;
  
  try {
    // Generate the next task_id
    const task_id = await generateNextTaskId();
    
    const insertQuery = `
      INSERT INTO tasks 
        (task_id, task_name, description, priority, due_date, completed, case_id, uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    
    db.query(insertQuery, [task_id, task_name, description, priority, due_date, completed, case_id, uid], (err, result) => {
      if (err) return res.status(500).send("Error adding task: " + err.message);
      res.status(201).json({ task_id, ...req.body });
    });
  } catch (err) {
    res.status(500).send("Error generating task ID.");
  }
});

// PUT: Update an existing task by task_id
app.put("/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  const updatedFields = req.body;
  updatedFields.updated_at = new Date();
  
  db.query("UPDATE tasks SET ? WHERE task_id = ?", [updatedFields, taskId], (err, result) => {
    if (err) return res.status(500).send("Error updating task.");
    if (result.affectedRows === 0) return res.status(404).send("Task not found.");
    res.send("Task updated successfully.");
  });
});

// DELETE: Delete a task by task_id
app.delete("/tasks/:id", (req, res) => {
  const taskId = req.params.id;
  db.query("DELETE FROM tasks WHERE task_id = ?", [taskId], (err, result) => {
    if (err) return res.status(500).send("Error deleting task.");
    if (result.affectedRows === 0) return res.status(404).send("Task not found.");
    res.send("Task deleted successfully.");
  });
});
// ------------------- STAFF ENDPOINTS -------------------

// Fetch all staff entries
app.get("/staff", (req, res) => {
  const query = "SELECT * FROM staff";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching staff:", err);
      return res.status(500).send("Error fetching staff.");
    }
    res.json(results);
  });
});

// Add a new staff entry
// When you create a user, call this endpoint (or integrate this code into your user creation flow)
// Adjust the fields as needed.
app.post("/staff", (req, res) => {
  // Log the request body for debugging
  console.log("Received staff creation request:", req.body);

  const {
    email,
    first_name,
    middle_initial,
    last_name,
    address_city,
    address_country,
    address_state,
    address_address1,
    address_address2,
    address_zip_code,
    cell_phone_number,
    work_phone_number,
    home_phone_number,
    type,
    title,
    active,
    default_hourly_rate,
  } = req.body;

  // Check if required fields exist
  if (!email || !first_name || !last_name) {
    return res.status(400).send("Missing required fields: email, first_name, or last_name.");
  }

  const insertQuery = `
    INSERT INTO staff
      (email, first_name, middle_initial, last_name,
       address_city, address_country, address_state,
       address_address1, address_address2, address_zip_code,
       cell_phone_number, work_phone_number, home_phone_number,
       type, title, active, default_hourly_rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  const values = [
    email,
    first_name,
    middle_initial,
    last_name,
    address_city,
    address_country,
    address_state,
    address_address1,
    address_address2,
    address_zip_code,
    cell_phone_number,
    work_phone_number,
    home_phone_number,
    type,
    title,
    active,
    default_hourly_rate,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Error adding staff:", err.sqlMessage || err);
      return res.status(500).send("Error adding staff: " + (err.sqlMessage || err.message));
    }
    console.log("Staff added successfully, insertId:", result.insertId);
    res.status(201).json({ staff_id: result.insertId, ...req.body });
  });
});

// Update a staff entry by staff_id
app.put("/staff/:id", (req, res) => {
  const staffId = req.params.id;
  const updatedFields = req.body;
  updatedFields.updated_at = new Date();
  db.query("UPDATE staff SET ? WHERE staff_id = ?", [updatedFields, staffId], (err, result) => {
    if (err) {
      console.error("Error updating staff:", err);
      return res.status(500).send("Error updating staff.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Staff not found.");
    }
    res.send("Staff updated successfully.");
  });
});

// Delete a staff entry by staff_id
app.delete("/staff/:id", (req, res) => {
  const staffId = req.params.id;
  db.query("DELETE FROM staff WHERE staff_id = ?", [staffId], (err, result) => {
    if (err) {
      console.error("Error deleting staff:", err);
      return res.status(500).send("Error deleting staff.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Staff not found.");
    }
    res.send("Staff deleted successfully.");
  });
});

// ------------------- ACTIVE USERS ENDPOINTS -------------------

// GET: Fetch only active staff entries (active = "Yes" regardless of case)
app.get("/active_users", (req, res) => {
  // We can filter in SQL to return only rows where active (after lowercasing) equals 'yes'
  const query = "SELECT * FROM active_users WHERE LOWER(active) = 'yes'";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching active users:", err);
      return res.status(500).send("Error fetching active users.");
    }
    res.json(results);
  });
});

// POST: Add a new staff entry
// This endpoint should be called after you create a Firebase user (so you can include the uid)
app.post("/active_users", (req, res) => {
  console.log("Received active user creation request:", req.body);

  const {
    uid = "", // default to empty string if not provided
    email,
    first_name,
    middle_initial = "",
    last_name,
    address_city = "",
    address_country = "",
    address_state = "",
    address_address1 = "",
    address_address2 = "",
    address_zip_code = "",
    cell_phone_number = "",
    work_phone_number = "",
    home_phone_number = "",
    type = "",
    title = "",
    active = "Yes", // force active to Yes (or use req.body.active if you wish)
    default_hourly_rate = 0,
  } = req.body;

  // Validate required fields
  if (!email || !first_name || !last_name) {
    return res
      .status(400)
      .send("Missing required fields: email, first_name, or last_name.");
  }

  // INSERT into active_users (staff_id is auto-increment)
  const insertQuery = `
    INSERT INTO active_users
      (email, first_name, middle_initial, last_name,
       address_city, address_country, address_state,
       address_address1, address_address2, address_zip_code,
       cell_phone_number, work_phone_number, home_phone_number,
       type, title, active, default_hourly_rate, uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  const values = [
    email,
    first_name,
    middle_initial,
    last_name,
    address_city,
    address_country,
    address_state,
    address_address1,
    address_address2,
    address_zip_code,
    cell_phone_number,
    work_phone_number,
    home_phone_number,
    type,
    title,
    active,
    default_hourly_rate,
    uid,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Error adding active user:", err.sqlMessage || err);
      return res
        .status(500)
        .send("Error adding active user: " + (err.sqlMessage || err.message));
    }
    console.log("Active user added successfully, insertId:", result.insertId);
    // Return the inserted row info (including the new staff_id)
    res.status(201).json({ staff_id: result.insertId, ...req.body });
  });
});

// PUT: Update a staff entry by staff_id
app.put("/active_users/:id", (req, res) => {
  const staffId = req.params.id;
  const updatedFields = req.body;
  // Update the updated_at column to the current timestamp
  updatedFields.updated_at = new Date();
  const updateQuery = "UPDATE active_users SET ? WHERE staff_id = ?";
  db.query(updateQuery, [updatedFields, staffId], (err, result) => {
    if (err) {
      console.error("Error updating active user:", err);
      return res.status(500).send("Error updating active user.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Active user not found.");
    }
    res.send("Active user updated successfully.");
  });
});

// DELETE: Delete a staff entry by staff_id (if needed)
app.delete("/active_users/:id", (req, res) => {
  const staffId = req.params.id;
  const deleteQuery = "DELETE FROM active_users WHERE staff_id = ?";
  db.query(deleteQuery, [staffId], (err, result) => {
    if (err) {
      console.error("Error deleting active user:", err);
      return res.status(500).send("Error deleting active user.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Active user not found.");
    }
    res.send("Active user deleted successfully.");
  });
});

// -----------------------------------------------CASE STAGES------------------------------------------------------
app.get("/case_stages", (req, res) => {
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
app.get("/case_stages/:id", (req, res) => {
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
app.post("/case_stages", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).send("Name is required.");
  }

  const query = "INSERT INTO case_stage (case_stage_name, created_at, updated_at) VALUES (?, NOW(), NOW())";
  db.query(query, [name], (err, result) => {
    if (err) {
      console.error("Error adding case stage:", err);
      return res.status(500).send("Error adding case stage.");
    }

    res.status(201).json({ id: result.insertId, name });
  });
});

// PUT - Update a case stage
app.put("/case_stages", (req, res) => {
  // Ensure your Express app uses express.json() middleware:
  // app.use(express.json());

  // Extract the array from the incoming payload
  const stages = req.body;
  console.log("Received stages:", stages, "body", req.body);

  if (!Array.isArray(stages) || stages.length === 0) {
    return res.status(400).send("Payload should be a non-empty array.");
  }

  let errors = [];
  let completed = 0;

  stages.forEach((stage) => {
    // Destructure stage_order along with id and name
    const { case_stage_id, case_stage_name, stage_order } = stage;
    if (!case_stage_id || !case_stage_name) {
      errors.push(`Missing case_stage_id or case_stage_name for stage: ${JSON.stringify(stage)}`);
      completed++;
      if (completed === stages.length) finalize();
      return;
    }

    const query = "UPDATE case_stage SET case_stage_name = ?, stage_order = ?, updated_at = NOW() WHERE case_stage_id = ?";
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
    // Return stages ordered by stage_order so the new sequence is preserved
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
app.delete("/case_stages/:id", (req, res) => {
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

// GET All Custom Fields with List Options
app.get("/custom_fields", (req, res) => {
const { parent_type } = req.query; // Get parent_type from query params

let query = `
  SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
  FROM custom_fields cf
  LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
`;

// Add a WHERE clause if parent_type is provided
if (parent_type) {
  query += ` WHERE cf.parent_type = ?`;
}

query += ` ORDER BY cf.created_at DESC`;

// Execute the query with or without parameter
db.query(query, parent_type ? [parent_type] : [], (err, results) => {
  if (err) {
    console.error("Error fetching custom fields:", err);
    return res.status(500).send("Error fetching custom fields.");
  }

  let customFields = {};

  results.forEach((row) => {
    if (!customFields[row.custom_fields_id]) {
      customFields[row.custom_fields_id] = {
        custom_fields_id: row.custom_fields_id,
        custom_fields_name: row.custom_fields_name,
        parent_type: row.parent_type,
        field_type: row.field_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        list_options: [],
      };
    }

    if (row.field_type === "list" && row.list_options_id) {
      customFields[row.custom_fields_id].list_options.push({
        list_options_id: row.list_options_id,
        option_key: row.option_key,
        option_value: row.option_value,
        created_at: row.option_created_at,
        updated_at: row.option_updated_at,
      });
    }
  });

  res.json(Object.values(customFields));
});
});


// GET Single Custom Field by ID with List Options
app.get("/custom_fields/:id", (req, res) => {
const id = req.params.id;
const query = `
  SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
  FROM custom_fields cf
  LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
  WHERE cf.custom_fields_id = ?
`;

db.query(query, [id], (err, results) => {
  if (err) {
    console.error("Error fetching custom field:", err);
    return res.status(500).send("Error fetching custom field.");
  }

  if (results.length === 0) {
    return res.status(404).send("Custom field not found.");
  }

  let customField = {
    custom_fields_id: results[0].custom_fields_id,
    custom_fields_name: results[0].custom_fields_name,
    parent_type: results[0].parent_type,
    field_type: results[0].field_type,
    created_at: results[0].created_at,
    updated_at: results[0].updated_at,
    list_options: [],
  };

  results.forEach((row) => {
    if (row.field_type === "list" && row.list_options_id) {
      customField.list_options.push({
        list_options_id: row.list_options_id,
        option_key: row.option_key,
        option_value: row.option_value,
        created_at: row.option_created_at,
        updated_at: row.option_updated_at,
      });
    }
  });

  res.json(customField);
});
});

// POST - Create a New Custom Field with List Options
// app.post("/custom_fields", (req, res) => {
//   const { custom_fields_name, parent_type, field_type, list_options } = req.body;

//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   const query =
//     "INSERT INTO custom_fields (custom_fields_name, parent_type, field_type, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())";

//   db.query(query, [custom_fields_name, parent_type, field_type], (err, result) => {
//     if (err) {
//       console.error("Error adding custom field:", err);
//       return res.status(500).send("Error adding custom field.");
//     }

//     const custom_fields_id = result.insertId;

//     if (field_type === "list" && Array.isArray(list_options)) {
//       const listOptionsQuery =
//         "INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) VALUES ?";
//       const listValues = list_options.map((opt) => [
//         custom_fields_id,
//         opt.option_key,
//         opt.option_value,
//         new Date(),
//         new Date(),
//       ]);

//       db.query(listOptionsQuery, [listValues], (err) => {
//         if (err) {
//           console.error("Error adding list options:", err);
//           return res.status(500).send("Error adding list options.");
//         }
//         res.status(201).json({ custom_fields_id, custom_fields_name, parent_type, field_type, list_options });
//       });
//     } else {
//       res.status(201).json({ custom_fields_id, custom_fields_name, parent_type, field_type });
//     }
//   });
// });
app.put("/custom_fields/:id/full_update", (req, res) => {
const id = req.params.id;
const { custom_fields_name, parent_type, field_type, list_options } = req.body;

if (!custom_fields_name || !parent_type || !field_type) {
  return res.status(400).send("All fields are required.");
}

// Check if new custom_fields_name already exists
const checkDuplicateQuery = `
  SELECT COUNT(*) AS count FROM custom_fields 
  WHERE custom_fields_name = ? AND custom_fields_id != ?`;

db.query(checkDuplicateQuery, [custom_fields_name, id], (err, results) => {
  if (err) {
    console.error("Error checking duplicate custom field:", err);
    return res.status(500).send("Error checking duplicate custom field.");
  }

  if (results[0].count > 0) {
    return res.status(409).send("Custom field with the same name already exists.");
  }

  // Fetch the current custom field details
  const fetchFieldQuery = `
    SELECT custom_fields_name, parent_type, field_type 
    FROM custom_fields WHERE custom_fields_id = ?`;

  db.query(fetchFieldQuery, [id], (err, fieldResults) => {
    if (err) {
      console.error("Error fetching custom field:", err);
      return res.status(500).send("Error fetching custom field.");
    }

    if (fieldResults.length === 0) {
      return res.status(404).send("Custom field not found.");
    }

    const oldCustomFieldsName = fieldResults[0].custom_fields_name;
    const oldParentType = fieldResults[0].parent_type;
    const oldFieldType = fieldResults[0].field_type;

    // Update the custom field details
    const updateFieldQuery = `
      UPDATE custom_fields 
      SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
      WHERE custom_fields_id = ?`;

    db.query(updateFieldQuery, [custom_fields_name, parent_type, field_type, id], (err, result) => {
      if (err) {
        console.error("Error updating custom field:", err);
        return res.status(500).send("Error updating custom field.");
      }

      let tableName = oldParentType === "case" ? "cases" : oldParentType;

      // Get the column type dynamically
      const getColumnTypeQuery = `
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`;

      db.query(getColumnTypeQuery, [tableName, oldCustomFieldsName], (err, columnResult) => {
        if (err) {
          console.error("Error fetching column type:", err);
          return res.status(500).send("Error fetching column type.");
        }

        if (columnResult.length === 0) {
          return res.status(404).send("Column not found in the database.");
        }

        const columnType = columnResult[0].COLUMN_TYPE;

        // Rename column while preserving its data type
        const renameColumnQuery = `
          ALTER TABLE \`${tableName}\` 
          CHANGE COLUMN \`${oldCustomFieldsName}\` \`${custom_fields_name}\` ${columnType}`;

        db.query(renameColumnQuery, (err) => {
          if (err) {
            console.error(`Error renaming column in ${tableName}:`, err);
            return res.status(500).send(`Error renaming column in ${tableName}: ${err.message}`);
          }

          updateListOptions();
        });
      });

      // Function to update list options and ENUM column
      function updateListOptions() {
        if (field_type === "list" && Array.isArray(list_options)) {
          const fetchOptionsQuery = `SELECT list_options_id FROM list_options WHERE custom_field_id_f = ?`;

          db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
            if (err) {
              console.error("Error fetching existing list options:", err);
              return res.status(500).send("Error fetching list options.");
            }

            const existingIds = existingOptions.map(option => option.list_options_id);
            const providedIds = list_options.map(option => option.list_options_id).filter(id => id !== undefined);
            const providedIds2 = list_options.map(option => option.option_value).filter(id => id !== undefined);

            // Determine which options to delete
            const idsToDelete = existingIds.filter(existingId => !providedIds.includes(existingId));
            const idsToAdd = providedIds.filter(newId => !existingIds.includes(newId));

            let updateQueries = [];

            // Delete removed list options
            if (idsToDelete.length > 0) {
              const deleteQuery = `DELETE FROM list_options WHERE list_options_id IN (?) AND custom_field_id_f = ?`;
              updateQueries.push(
                new Promise((resolve, reject) => {
                  db.query(deleteQuery, [idsToDelete, id], (err, result) => {
                    if (err) {
                      console.error("Error deleting list options:", err);
                      reject(err);
                    } else {
                      resolve(result);
                    }
                  });
                })
              );
            }

            // Insert new list options
            list_options.forEach((option) => {
              if (!existingIds.includes(option.list_options_id)) {
                const insertQuery = `
                  INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
                  VALUES (?, ?, ?, NOW(), NOW())`;

                updateQueries.push(
                  new Promise((resolve, reject) => {
                    db.query(insertQuery, [id, option.option_key, option.option_value], (err, result) => {
                      if (err) {
                        console.error("Error inserting list option:", err);
                        reject(err);
                      } else {
                        resolve(result);
                      }
                    });
                  })
                );
              }
            });

            // Update ENUM column in cases table based on list_options_id
            const newEnumValues = providedIds2.length > 0 ? providedIds2.map(id => `'${id}'`).join(",") : "'N/A'";
            const alterEnumQuery = `
              ALTER TABLE \`${tableName}\` 
              MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

            updateQueries.push(
              new Promise((resolve, reject) => {
                db.query(alterEnumQuery, (err) => {
                  if (err) {
                    console.error(`Error modifying ENUM column in ${tableName}:`, err);
                    reject(err);
                  } else {
                    resolve();
                  }
                });
              })
            );

            Promise.all(updateQueries)
              .then(() => {
                res.send("Custom field, list options, and ENUM column updated successfully.");
              })
              .catch((err) => {
                console.error("Error updating list options:", err);
                res.status(500).send("Error updating list options.");
              });
          });
        } else {
          res.send("Custom field updated successfully.");
        }
      }
    });
  });
});
});



app.put("/custom_fields/:id", (req, res) => {
const id = req.params.id;
const { custom_fields_name, parent_type, field_type } = req.body;

if (!custom_fields_name || !parent_type || !field_type) {
  return res.status(400).send("All fields are required.");
}

const updateQuery = `
  UPDATE custom_fields 
  SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
  WHERE custom_fields_id = ?`;

db.query(updateQuery, [custom_fields_name, parent_type, field_type, id], (err, result) => {
  if (err) {
    console.error("Error updating custom field:", err);
    return res.status(500).send("Error updating custom field.");
  }

  if (result.affectedRows === 0) {
    return res.status(404).send("Custom field not found.");
  }

  res.send("Custom field updated successfully.");
});
});
app.put("/custom_fields/:id/list_options", (req, res) => {
const { list_options } = req.body;

if (!Array.isArray(list_options) || list_options.length === 0) {
  return res.status(400).send("List options are required.");
}

let updateQueries = list_options.map((option) => {
  return new Promise((resolve, reject) => {
    const updateQuery = `
      UPDATE list_options 
      SET option_key = ?, option_value = ?, updated_at = NOW() 
      WHERE list_options_id = ?`;

    db.query(updateQuery, [option.option_key, option.option_value, option.list_options_id], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
});

Promise.all(updateQueries)
  .then(() => {
    res.send("List options updated successfully.");
  })
  .catch((err) => {
    console.error("Error updating list options:", err);
    res.status(500).send("Error updating list options.");
  });
});

app.put("/custom_fields/:id/full_update", (req, res) => {
const id = req.params.id;
const { custom_fields_name, parent_type, field_type, list_options } = req.body;

if (!custom_fields_name || !parent_type || !field_type) {
  return res.status(400).send("All fields are required.");
}

// Check if new custom_fields_name already exists
const checkDuplicateQuery = `
  SELECT COUNT(*) AS count FROM custom_fields 
  WHERE custom_fields_name = ? AND custom_fields_id != ?`;

db.query(checkDuplicateQuery, [custom_fields_name, id], (err, results) => {
  if (err) {
    console.error("Error checking duplicate custom field:", err);
    return res.status(500).send("Error checking duplicate custom field.");
  }

  if (results[0].count > 0) {
    return res.status(409).send("Custom field with the same name already exists.");
  }

  // Fetch the current custom field details
  const fetchFieldQuery = `
    SELECT custom_fields_name, parent_type, field_type 
    FROM custom_fields WHERE custom_fields_id = ?`;

  db.query(fetchFieldQuery, [id], (err, fieldResults) => {
    if (err) {
      console.error("Error fetching custom field:", err);
      return res.status(500).send("Error fetching custom field.");
    }

    if (fieldResults.length === 0) {
      return res.status(404).send("Custom field not found.");
    }

    const oldCustomFieldsName = fieldResults[0].custom_fields_name;
    const oldParentType = fieldResults[0].parent_type;
    const oldFieldType = fieldResults[0].field_type;

    // Update the custom field details
    const updateFieldQuery = `
      UPDATE custom_fields 
      SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
      WHERE custom_fields_id = ?`;

    db.query(updateFieldQuery, [custom_fields_name, parent_type, field_type, id], (err, result) => {
      if (err) {
        console.error("Error updating custom field:", err);
        return res.status(500).send("Error updating custom field.");
      }

      let tableName = oldParentType === "case" ? "cases" : oldParentType;

      // Get the column type dynamically
      const getColumnTypeQuery = `
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`;

      db.query(getColumnTypeQuery, [tableName, oldCustomFieldsName], (err, columnResult) => {
        if (err) {
          console.error("Error fetching column type:", err);
          return res.status(500).send("Error fetching column type.");
        }

        if (columnResult.length === 0) {
          return res.status(404).send("Column not found in the database.");
        }

        const columnType = columnResult[0].COLUMN_TYPE;

        // Rename column while preserving its data type
        const renameColumnQuery = `
          ALTER TABLE \`${tableName}\` 
          CHANGE COLUMN \`${oldCustomFieldsName}\` \`${custom_fields_name}\` ${columnType}`;

        db.query(renameColumnQuery, (err) => {
          if (err) {
            console.error(`Error renaming column in ${tableName}:`, err);
            return res.status(500).send(`Error renaming column in ${tableName}: ${err.message}`);
          }

          updateListOptions();
        });
      });

      // Function to update list options and ENUM column
      function updateListOptions() {
        if (field_type === "list" && Array.isArray(list_options)) {
          const fetchOptionsQuery = `SELECT option_key FROM list_options WHERE custom_field_id_f = ?`;

          db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
            if (err) {
              console.error("Error fetching existing list options:", err);
              return res.status(500).send("Error fetching list options.");
            }

            const existingKeys = existingOptions.map(option => option.option_key);
            const newKeys = list_options.map(option => option.option_key);

            // Determine which options to delete
            const keysToDelete = existingKeys.filter(key => !newKeys.includes(key));
            const keysToAdd = newKeys.filter(key => !existingKeys.includes(key));

            let updateQueries = [];

            // Delete removed list options
            if (keysToDelete.length > 0) {
              const deleteQuery = `DELETE FROM list_options WHERE option_key IN (?) AND custom_field_id_f = ?`;
              updateQueries.push(
                new Promise((resolve, reject) => {
                  db.query(deleteQuery, [keysToDelete, id], (err, result) => {
                    if (err) {
                      console.error("Error deleting list options:", err);
                      reject(err);
                    } else {
                      resolve(result);
                    }
                  });
                })
              );
            }

            // Insert new list options
            keysToAdd.forEach((key) => {
              const option = list_options.find(opt => opt.option_key === key);
              const insertQuery = `
                INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
                VALUES (?, ?, ?, NOW(), NOW())`;

              updateQueries.push(
                new Promise((resolve, reject) => {
                  db.query(insertQuery, [id, option.option_key, option.option_value], (err, result) => {
                    if (err) {
                      console.error("Error inserting list option:", err);
                      reject(err);
                    } else {
                      resolve(result);
                    }
                  });
                })
              );
            });

            // Update ENUM column in cases table
            const newEnumValues = newKeys.length > 0 ? newKeys.map(key => `'${key}'`).join(",") : "'N/A'";
            const alterEnumQuery = `
              ALTER TABLE \`${tableName}\` 
              MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

            updateQueries.push(
              new Promise((resolve, reject) => {
                db.query(alterEnumQuery, (err) => {
                  if (err) {
                    console.error(`Error modifying ENUM column in ${tableName}:`, err);
                    reject(err);
                  } else {
                    resolve();
                  }
                });
              })
            );

            Promise.all(updateQueries)
              .then(() => {
                res.send("Custom field, list options, and ENUM column updated successfully.");
              })
              .catch((err) => {
                console.error("Error updating list options:", err);
                res.status(500).send("Error updating list options.");
              });
          });
        } else {
          res.send("Custom field updated successfully.");
        }
      }
    });
  });
});
});




// DELETE - Delete a Custom Field and List Options
app.delete("/custom_fields/:id", (req, res) => {
const id = req.params.id;

// Fetch the custom field details before deletion
const fetchQuery = "SELECT custom_fields_name, parent_type FROM custom_fields WHERE custom_fields_id = ?";

db.query(fetchQuery, [id], (err, result) => {
  if (err) {
    console.error("Error fetching custom field:", err);
    return res.status(500).send("Error fetching custom field.");
  }

  if (result.length === 0) {
    return res.status(404).send("Custom field not found.");
  }

  const { custom_fields_name, parent_type } = result[0];
  let tableName = parent_type === "case" ? "cases" : parent_type;

  // Delete column from the table
  const alterTableQuery = `ALTER TABLE \`${tableName}\` DROP COLUMN \`${custom_fields_name}\``;

  db.query(alterTableQuery, (err) => {
    if (err) {
      console.error(`Error dropping column ${custom_fields_name} from ${tableName}:`, err);
      return res.status(500).send(`Error dropping column ${custom_fields_name} from ${tableName}: ${err.message}`);
    }

    // Delete associated list options if any
    const deleteListOptionsQuery = "DELETE FROM list_options WHERE custom_field_id_f = ?";
    db.query(deleteListOptionsQuery, [id], (err) => {
      if (err) {
        console.error("Error deleting list options:", err);
        return res.status(500).send("Error deleting list options.");
      }

      // Delete the custom field from the database
      const deleteQuery = "DELETE FROM custom_fields WHERE custom_fields_id = ?";
      db.query(deleteQuery, [id], (err, result) => {
        if (err) {
          console.error("Error deleting custom field:", err);
          return res.status(500).send("Error deleting custom field.");
        }

        if (result.affectedRows === 0) {
          return res.status(404).send("Custom field not found.");
        }

        res.send("Custom field and related column deleted successfully.");
      });
    });
  });
});
});



app.get("/columns", (req, res) => {
const parentType = req.query.parent_type; 
if (!parentType) {
    return res.status(400).json({ error: "parent_type is required" });
}

const tableName = `${parentType}s`; 

const tableColumnsQuery = `SHOW COLUMNS FROM \`${tableName}\``;
const customFieldsQuery = `
  SELECT cf.*, 
         lo.list_options_id, 
         lo.option_key, 
         lo.option_value, 
         lo.created_at AS option_created_at, 
         lo.updated_at AS option_updated_at
  FROM custom_fields cf
  LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
  WHERE cf.parent_type = ?
`;

db.query(tableColumnsQuery, (err, tableResults) => {
    if (err) {
        console.error("Error fetching table columns:", err);
        return res.status(500).json({ error: "Error fetching table columns.", details: err });
    }

    db.query(customFieldsQuery, [parentType], (err, customFieldsResults) => {
        if (err) {
            console.error("Error fetching custom fields:", err);
            return res.status(500).json({ error: "Error fetching custom fields.", details: err });
        }

        const tableColumns = tableResults.map(row => row.Field);

        const customFieldsMap = new Map();

        customFieldsResults.forEach((row) => {
            if (!customFieldsMap.has(row.custom_fields_id)) {
                customFieldsMap.set(row.custom_fields_id, {
                    custom_fields_id: row.custom_fields_id,
                    custom_fields_name: row.custom_fields_name,
                    parent_type: row.parent_type,
                    field_type: row.field_type,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    list_options: [],
                });
            }

            if (row.field_type === "list" && row.list_options_id) {
                customFieldsMap.get(row.custom_fields_id).list_options.push({
                    list_options_id: row.list_options_id,
                    option_key: row.option_key,
                    option_value: row.option_value,
                    created_at: row.option_created_at,
                    updated_at: row.option_updated_at,
                });
            }
        });

        const customFields = Array.from(customFieldsMap.values());

        res.json({
            table_columns: tableColumns,      
            custom_fields: customFields      
        });
    });
});
});




app.get("/active-users", (req, res) => {
  const loggedInUID = req.headers["x-user-id"];
 
  db.query("SELECT staff_id,uid,first_name,last_name,email FROM active_users WHERE uid IS NOT NULL", (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
 
      const activeUsers = results.map(user => ({
        staff_id: user.staff_id,
        uid: user.uid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email
      }));
 
      res.json({ activeUsers, loggedInUID });
  });
});
 

// ------------------------ time entries -----------------------------//

app.get("/time_entries", (req, res) => {
  const { case_id, range, start_date, end_date, page = 1, limit = 20 } = req.query;
 
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
    conditions.push("YEAR(entry_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 YEAR))");
  } else if (range === "month_to_date") {
    conditions.push("entry_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
  } else if (range === "year_to_date") {
    conditions.push("entry_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')");
  } else if (start_date && end_date) {
    conditions.push("entry_date BETWEEN ? AND ?");
    values.push(start_date, end_date);
  }
 
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
  const entriesQuery = `
    SELECT time_entry_id, description, entry_date, billable, case_id, staff_id, activity_name,
           created_at, updated_at, rate, flat_fee, hours
    FROM time_entries
    ${whereClause}
    ORDER BY entry_date DESC
    LIMIT ? OFFSET ?
  `;
  values.push(limitNumber, offset);
 
  const countQuery = `SELECT COUNT(*) as total FROM time_entries ${whereClause}`;
 
  // --- Updated Query for Total Rates Summary ---
  const rateSummaryQuery = `
    SELECT
      SUM(CASE WHEN billable = 1 THEN rate ELSE 0 END) AS total_billable_rate,
      SUM(CASE WHEN billable = 0 THEN rate ELSE 0 END) AS total_non_billable_rate,
      SUM(rate * hours) AS total_rate_hours
    FROM time_entries
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
 
      db.query(rateSummaryQuery, values.slice(0, -2), (err, rateSummaryResults) => {
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
            recordsPerPage: limitNumber
          },
          rateSummary: {
            billable_rate: rateSummaryResults[0]?.total_billable_rate || 0,
            non_billable_rate: rateSummaryResults[0]?.total_non_billable_rate || 0,
            total_rate_hours: rateSummaryResults[0]?.total_rate_hours || 0
          }
        });
      });
    });
  });
});
 
 
 
app.get("/time_entries/:id", (req, res) => {
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
 
 
app.post("/time_entries", (req, res) => {
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
    uid
  } = req.body;
 
  if (!description || !entry_date || !case_id  || !activity_name || !rate || !hours) {
    return res.status(400).send("Missing required fields.");
  }
 
  const query = `
    INSERT INTO time_entries (description, entry_date, billable, case_id, staff_id, activity_name,
                              created_at, updated_at, rate, flat_fee, hours, uid)
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?,?)
  `;
 
  const values = [description, entry_date, billable, case_id, staff_id, activity_name, rate, flat_fee, hours, uid];
 
  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error adding time entry:", err);
      return res.status(500).send("Error adding time entry.");
    }
    res.status(201).json({ message: "Time entry created successfully", time_entry_id: result.insertId });
  });
});
 
 
app.put("/time_entries/:id", (req, res) => {
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
        updated_at = NOW(), rate = ?, flat_fee = ?, hours = ?
    WHERE time_entry_id = ?
  `;
 
  const values = [description, entry_date, billable, case_id, staff_id, activity_name, rate, flat_fee, hours, req.params.id];
 
  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error updating time entry:", err);
      return res.status(500).send("Error updating time entry.");
    }
    if (result.affectedRows === 0) {
      return res.status(404).send("Time entry not found.");
    }
    res.json({ message: "Time entry updated successfully" });
  });
});
 
 
app.delete("/time_entries/:id", (req, res) => {
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
app.post('/activity', (req, res) => {
  const { activity_name } = req.body; // Change name to activity_name
  const query = 'INSERT INTO activity (activity_name) VALUES (?)'; // Adjust query to match column name
  db.query(query, [activity_name], (err, result) => { // Use activity_name here
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: result.insertId, activity_name }); // Use activity_name here
  });
});
 


// Start the server
const PORT = 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});