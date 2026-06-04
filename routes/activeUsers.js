// routes/activeUsers.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/** PostgreSQL-compatible dynamic UPDATE (mysql2 `SET ?` is not supported). */
function buildUpdateSet(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  return {
    sql: keys.map((col) => `${col} = ?`).join(", "),
    values: keys.map((col) => fields[col]),
  };
}

// GET /active_users – fetch active users (active = "Yes")
router.get("/active_users", (req, res) => {
  db.query("SELECT * FROM active_users WHERE LOWER(active) = 'yes'", (err, results) => {
    if (err) {
      console.error("Error fetching active users:", err);
      return res.status(500).send("Error fetching active users.");
    }
    res.json(results);
  });
});
router.get("/active-users", (req, res) => {
  const loggedInUID = req.headers["x-user-id"];
 
  // Query for active users - ADD default_hourly_rate to the SELECT
  db.query(
    "SELECT staff_id, uid, first_name, last_name, email, default_hourly_rate FROM active_users WHERE uid IS NOT NULL",
    (err, activeResults) => {
      if (err) return res.status(500).json({ error: err.message });
 
      const activeUsers = activeResults.map((user) => ({
        staff_id: user.staff_id,
        uid: user.uid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        default_hourly_rate: user.default_hourly_rate,
      }));
 
      // Query for staff data
      db.query("SELECT * FROM staff", (err, staffResults) => {
        if (err) return res.status(500).json({ error: err.message });
 
        res.json({ activeUsers, staff: staffResults, loggedInUID });
      });
    }
  );
});
// POST /active_users – create a new active user
router.post("/active_users", (req, res) => {
  const {
    uid = "", email, first_name, middle_initial = "", last_name,
    address_city = "", address_country = "", address_state = "", address_address1 = "",
    address_address2 = "", address_zip_code = "", cell_phone_number = "",
    work_phone_number = "", home_phone_number = "", type = "", title = "",
    active = "Yes", default_hourly_rate = 0,
    permissions = "All firm cases",
    access_all_cases = false,
    disabled = "No",
  } = req.body;
  if (!email || !first_name || !last_name) {
    return res.status(400).send("Missing required fields: email, first_name, or last_name.");
  }
  const permissionsVal =
    permissions == null || permissions === "" ? "All firm cases" : permissions;
  const disabledVal = disabled == null || disabled === "" ? "No" : disabled;
  const accessAllCases =
    access_all_cases === true ||
    access_all_cases === 1 ||
    access_all_cases === "1" ||
    access_all_cases === "true";
  const insertQuery = `
    INSERT INTO active_users
      (email, first_name, middle_initial, last_name, address_city, address_country, address_state,
       address_address1, address_address2, address_zip_code, cell_phone_number, work_phone_number,
       home_phone_number, type, title, active, default_hourly_rate, uid,
       permissions, access_all_cases, disabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;
  const values = [email, first_name, middle_initial, last_name, address_city, address_country, address_state,
    address_address1, address_address2, address_zip_code, cell_phone_number, work_phone_number,
    home_phone_number, type, title, active, default_hourly_rate, uid,
    permissionsVal, accessAllCases, disabledVal];
  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Error adding active user:", err.sqlMessage || err);
      return res.status(500).send("Error adding active user: " + (err.sqlMessage || err.message));
    }
    res.status(201).json({
      staff_id: result.insertId,
      permissions: permissionsVal,
      access_all_cases: accessAllCases ? 1 : 0,
      disabled: disabledVal,
      ...req.body,
    });
  });
});

// PUT /active_users/:id – update active user
router.put("/active_users/:id", (req, res) => {
  const staffId = req.params.id;
  const updatedFields = { ...req.body, updated_at: new Date() };
  const set = buildUpdateSet(updatedFields);
  if (!set) return res.status(400).send("No fields to update.");
  db.query(
    `UPDATE active_users SET ${set.sql} WHERE staff_id = ?`,
    [...set.values, staffId],
    (err, result) => {
    if (err) {
      console.error("Error updating active user:", err);
      return res.status(500).send("Error updating active user.");
    }
    if (!result.affectedRows) return res.status(404).send("Active user not found.");
    res.send("Active user updated successfully.");
  }
  );
});

// DELETE /active_users/:id – delete an active user
router.delete("/active_users/:id", (req, res) => {
  const staffId = req.params.id;
  db.query("DELETE FROM active_users WHERE staff_id = ?", [staffId], (err, result) => {
    if (err) {
      console.error("Error deleting active user:", err);
      return res.status(500).send("Error deleting active user.");
    }
    if (!result.affectedRows) return res.status(404).send("Active user not found.");
    res.send("Active user deleted successfully.");
  });
});
// PUT /active_users/:id/disable – disable a user (set disabled = "Yes")
router.put("/active_users/:id/disable", (req, res) => {
  const staffId = req.params.id;
  const updated_at = new Date();
  
  db.query("UPDATE active_users SET disabled = 'Yes', updated_at = ? WHERE staff_id = ?", [updated_at, staffId], (err, result) => {
    if (err) {
      console.error("Error disabling user:", err);
      return res.status(500).send("Error disabling user.");
    }
    if (!result.affectedRows) return res.status(404).send("User not found.");
    res.send("User disabled successfully.");
  });
});

// PUT /active_users/:id/enable – enable a user (set disabled = "No")
router.put("/active_users/:id/enable", (req, res) => {
  const staffId = req.params.id;
  const updated_at = new Date();
  
  db.query("UPDATE active_users SET disabled = 'No', updated_at = ? WHERE staff_id = ?", [updated_at, staffId], (err, result) => {
    if (err) {
      console.error("Error enabling user:", err);
      return res.status(500).send("Error enabling user.");
    }
    if (!result.affectedRows) return res.status(404).send("User not found.");
    res.send("User enabled successfully.");
  });
});
// GET /users/:uid/profile-image – fetch profile image URL for a user
router.get("/users/:uid/profile-image", async (req, res) => {
  const uid = req.params.uid;
  const query = `
    SELECT CONCAT(?, "/", path) AS image_url
    FROM media
    WHERE uid = ? AND description = 'Profile Image'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const [rows] = await db.promise().query(query, [baseUrl, uid]);
    if (rows.length) res.json({ imageUrl: rows[0].image_url });
    else res.status(404).json({ message: "No profile image found." });
  } catch (err) {
    console.error("Error fetching profile image:", err);
    res.status(500).json({ message: "Error retrieving profile image." });
  }
});

router.put("/active_users_basic/:id", (req, res) => {
  const staffId = req.params.id;
  const { email, first_name, last_name, type, title, ...otherFields } = req.body;
  const updated_at = new Date();
 
  // Remove empty or undefined fields to avoid overwriting with empty values
  const filteredFields = Object.fromEntries(
    Object.entries({ email, first_name, last_name, type, title, ...otherFields }).filter(([_, value]) =>
      value !== "" && value !== undefined && value !== null
    )
  );
 
  // Add updated_at timestamp
  filteredFields.updated_at = updated_at;

  const set = buildUpdateSet(filteredFields);
  if (!set) return res.status(400).send("No fields to update.");

  // Update only the basic staff information
  db.query(
    `UPDATE active_users SET ${set.sql} WHERE staff_id = ?`,
    [...set.values, staffId],
    (err, result) => {
    if (err) {
      console.error("Error updating active user basic info:", err);
      return res.status(500).send("Error updating active user information.");
    }
 
    if (!result.affectedRows) {
      return res.status(404).send("Active user not found.");
    }
 
    res.send("Active user information updated successfully.");
  }
  );
});

router.get("/users/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const [rows] = await db.promise().query(
      "SELECT staff_id, uid, first_name, last_name, email FROM active_users WHERE uid = ? LIMIT 1",
      [uid]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found for uid." });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching user by uid:", err);
    return res.status(500).json({ message: "Error fetching user." });
  }
});




module.exports = router;