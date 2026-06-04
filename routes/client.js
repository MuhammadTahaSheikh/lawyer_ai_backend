const express = require("express");
const router = express.Router();
const db = require("../db");

// Utility: whitelist sort to prevent SQL injection via ORDER BY
function buildSafeSort(rawSort) {
  const defaultSort = { field: "created_at", dir: "DESC" };
  if (!rawSort) return `${defaultSort.field} ${defaultSort.dir}`;

  // Allow only these fields and directions
  const allowedFields = new Set(["id", "first_name", "last_name", "email", "created_at"]);
  const allowedDirs = new Set(["ASC", "DESC"]);

  // Examples we accept:
  //   "created_at DESC"
  //   "email ASC"
  //   "last_name"
  const parts = String(rawSort).trim().split(/\s+/);
  const field = parts[0];
  const dir = (parts[1] || "ASC").toUpperCase();

  const safeField = allowedFields.has(field) ? field : defaultSort.field;
  const safeDir = allowedDirs.has(dir) ? dir : defaultSort.dir;

  return `${safeField} ${safeDir}`;
}

// GET /clients – Paginated, searchable, filterable, with optional permission scoping
router.get("/clients", (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const fetchAll = String(req.query.fetch_all || "").toLowerCase() === "true";
  const limit = fetchAll ? null : 20;
  const offset = fetchAll ? 0 : (page - 1) * limit;

  const search = req.query.search || "";
  const group = req.query.group || "";
  const sort = buildSafeSort(req.query.sort || "created_at DESC");
  const uid = req.query.uid || "";
  const email = (req.query.email || "").trim().toLowerCase(); // NEW: email filter

  let conditions = [];
  let values = [];

  // If an exact email is provided, filter by it (case-insensitive).
  // (If you want search to ALSO apply, move this into an `if (email) { conditions.push... }` block
  // and keep the search block below without the `else`.)
  if (email) {
    conditions.push("LOWER(email) = ?");
    values.push(email);
  } else if (search) {
    const tokens = search.trim().split(/\s+/);
    const tokenConditions = [];
    tokens.forEach((token) => {
      tokenConditions.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR cell_phone_number LIKE ?)");
      values.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
    });
    if (tokenConditions.length > 0) {
      conditions.push(`(${tokenConditions.join(" AND ")})`);
    }
  }

  if (group) {
    conditions.push("contact_group = ?");
    values.push(group);
  }

  // Permission-based filtering if uid is provided and show_all is not true
  if (uid && req.query.show_all !== "true") {
    const permissionQuery = `
      SELECT
        (SELECT GROUP_CONCAT(DISTINCT case_id) FROM user_case_assignments WHERE uid = ?) AS case_ids,
        (SELECT GROUP_CONCAT(DISTINCT practice_area) FROM user_practice_areas WHERE uid = ?) AS practice_areas
    `;

    db.query(permissionQuery, [uid, uid], (err, permissionResult) => {
      if (err) {
        console.error("Error checking user permissions:", err);
        return res.status(500).send("Error checking permissions.");
      }

      const caseIdList =
        permissionResult[0]?.case_ids?.split(",").map(Number).filter(Boolean) || [];
      const practiceAreaList =
        permissionResult[0]?.practice_areas?.split(",").map(String).filter(Boolean) || [];

      // If user has no case assignments AND no practice areas, show all contacts
      if (caseIdList.length === 0 && practiceAreaList.length === 0) {
        finalizeQuery();
        return;
      }

      // Build permission conditions
      const permissionConditions = [];
      const permissionParams = [];

      // 1. Direct ownership
      permissionConditions.push("(uid = ?)");
      permissionParams.push(uid);

      // 2. Cases assigned via case_ids
      if (caseIdList.length > 0) {
        permissionConditions.push(`id IN (
          SELECT DISTINCT contact_id FROM cases WHERE case_id IN (${caseIdList.map(() => "?").join(",")})
        ) OR id IN (
          SELECT DISTINCT client_id FROM client_case WHERE case_id IN (${caseIdList.map(() => "?").join(",")})
        )`);
        permissionParams.push(...caseIdList, ...caseIdList);
      }

      // 3. Cases in assigned practice areas
      if (practiceAreaList.length > 0) {
        permissionConditions.push(`id IN (
          SELECT DISTINCT contact_id FROM cases WHERE practice_area IN (${practiceAreaList.map(() => "?").join(",")})
        ) OR id IN (
          SELECT DISTINCT client_id FROM client_case cc
          JOIN cases c ON cc.case_id = c.case_id
          WHERE c.practice_area IN (${practiceAreaList.map(() => "?").join(",")})
        )`);
        permissionParams.push(...practiceAreaList, ...practiceAreaList);
      }

      if (permissionConditions.length > 0) {
        conditions.push(`(${permissionConditions.join(" OR ")})`);
        values.push(...permissionParams);
      }

      finalizeQuery();
    });

    // Continue in callback
    return;
  }

  // No permission filtering needed
  finalizeQuery();

  function finalizeQuery() {
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countQuery = `SELECT COUNT(*) AS totalClients FROM client ${whereClause}`;
    const clientsQuery = `
      SELECT
        id,
        first_name,
        last_name,
        email,
        cell_phone_number,
        contact_group,
        created_at,
        uid
      FROM client
      ${whereClause}
      ORDER BY ${sort}
      ${fetchAll ? "" : "LIMIT ? OFFSET ?"}
    `;

    db.query(countQuery, values, (err, countResult) => {
      if (err) {
        console.error("Error counting clients:", err);
        return res.status(500).send("Error counting clients.");
      }
      const totalClients = countResult[0]?.totalClients || 0;

      const clientParams = fetchAll ? [...values] : [...values, limit, offset];

      db.query(clientsQuery, clientParams, async (err, clientsResult) => {
        if (err) {
          console.error("Error fetching clients:", err);
          return res.status(500).send("Error fetching clients.");
        }

        const clientIds = clientsResult.map((client) => client.id);
        if (clientIds.length === 0) {
          return res.json({ totalClients, clients: clientsResult.map((c) => ({ ...c, cases: [] })) });
        }

        const contactIdCasesQuery = `SELECT case_id, name, contact_id FROM cases WHERE contact_id IN (?)`;
        const clientCasesQuery = `
          SELECT c.case_id, c.name, cc.client_id
          FROM cases c
          JOIN client_case cc ON c.case_id = cc.case_id
          WHERE cc.client_id IN (?)
        `;

        try {
          const [contactIdCases, clientCases] = await Promise.all([
            new Promise((resolve, reject) => {
              db.query(contactIdCasesQuery, [clientIds], (err, result) => {
                if (err) reject(err);
                else resolve(result || []);
              });
            }),
            new Promise((resolve, reject) => {
              db.query(clientCasesQuery, [clientIds], (err, result) => {
                if (err) reject(err);
                else resolve(result || []);
              });
            }),
          ]);

          const allCases = [...contactIdCases, ...clientCases];
          const casesByClientId = allCases.reduce((acc, caseItem) => {
            const clientId = caseItem.contact_id || caseItem.client_id;
            if (!clientId) return acc;

            if (!acc[clientId]) acc[clientId] = [];
            acc[clientId].push({
              id: caseItem.case_id,
              name: caseItem.name,
            });
            return acc;
          }, {});

          const clients = clientsResult.map((client) => ({
            ...client,
            cases: casesByClientId[client.id] || [],
          }));

          res.json({ totalClients, clients });
        } catch (error) {
          console.error("Error fetching cases:", error);
          return res.status(500).send("Error fetching cases.");
        }
      });
    });
  }
});

// GET /clients/by-case/:caseId – Get client(s) associated with a given case id (via cases.contact_id and/or client_case)
router.get("/clients/by-case/:caseId", (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (Number.isNaN(caseId)) {
    return res.status(400).send("Invalid case id.");
  }

  const getCaseSql = `
    SELECT case_id, name, contact_id, practice_area
    FROM cases
    WHERE case_id = ?
    LIMIT 1
  `;

  db.query(getCaseSql, [caseId], (caseErr, caseRows) => {
    if (caseErr) {
      console.error("Error fetching case:", caseErr);
      return res.status(500).send("Error fetching case.");
    }
    if (!caseRows || caseRows.length === 0) {
      return res.status(404).send("Case not found.");
    }

    const caseInfo = caseRows[0];
    const contactId = caseInfo.contact_id ? Number(caseInfo.contact_id) : null;

    const baseClientSelect = `
      SELECT
        c.id,
        c.email,
        c.first_name,
        c.middle_initial AS middle_name,
        c.last_name,
        c.contact_group,
        c.cell_phone_number AS mobile_phone,
        c.work_phone_number AS work_phone,
        c.home_phone_number AS home_phone,
        c.address_line,
        c.city,
        c.state,
        c.zip_code,
        c.country,
        c.timezone,
        c.birthdate,
        c.company,
        c.job_title,
        c.driver_license,
        c.driver_state,
        c.website,
        c.fax_number,
        c.notes,
        c.uid,
        c.updated_at,
        c.created_at
      FROM client c
    `;

    const ownerQuery = contactId ? `${baseClientSelect} WHERE c.id = ?` : null;

    const linkedQuery = `
      ${baseClientSelect}
      INNER JOIN client_case cc ON cc.client_id = c.id
      WHERE cc.case_id = ?
    `;

    const runOwnerQuery = () =>
      new Promise((resolve) => {
        if (!ownerQuery) return resolve([]);
        db.query(ownerQuery, [contactId], (err, rows) => {
          if (err) {
            console.error("Error fetching owner client by contact_id:", err);
            return resolve([]);
          }
          resolve(rows || []);
        });
      });

    const runLinkedQuery = () =>
      new Promise((resolve, reject) => {
        db.query(linkedQuery, [caseId], (err, rows) => {
          if (err) {
            console.error("Error fetching linked clients via client_case:", err);
            return reject(err);
          }
          resolve(rows || []);
        });
      });

    Promise.all([runOwnerQuery(), runLinkedQuery()])
      .then(([ownerRows, linkedRows]) => {
        const byId = new Map();
        [...ownerRows, ...linkedRows].forEach((c) => {
          if (!byId.has(c.id)) byId.set(c.id, c);
        });
        const clients = Array.from(byId.values());

        return res.json({
          case: {
            case_id: caseInfo.case_id,
            name: caseInfo.name,
            practice_area: caseInfo.practice_area ?? null,
          },
          clients,
        });
      })
      .catch((e) => {
        console.error("Error assembling clients by case:", e);
        return res.status(500).send("Error fetching clients by case.");
      });
  });
});

// GET /clients/:id – Get single client
router.get("/clients/:id", (req, res) => {
  const clientId = req.params.id;
  db.query("SELECT * FROM client WHERE id = ?", [clientId], (err, result) => {
    if (err) return res.status(500).send("Error fetching client.");
    if (!result.length) return res.status(404).send("Client not found.");
    res.json(result[0]);
  });
});

// POST /clients – Create new client
router.post("/clients", (req, res) => {
  const {
    id,
    email,
    first_name,
    middle_name,
    last_name,
    contact_group,
    mobile_phone,
    work_phone,
    home_phone,
    home_street,
    home_street_2,
    home_city,
    home_state,
    home_postal_code,
    home_country,
    timezone,
    birthdate,
    company,
    job_title,
    driver_license,
    driver_state,
    website,
    fax_number,
    notes,
    uid,
    updated_at,
    created_at,
  } = req.body;

  const address_line = `${home_street || ""} ${home_street_2 || ""}`.trim();
  const columns = [
    "email",
    "first_name",
    "middle_initial",
    "last_name",
    "contact_group",
    "cell_phone_number",
    "work_phone_number",
    "home_phone_number",
    "address_line",
    "city",
    "state",
    "zip_code",
    "country",
    "timezone",
    "birthdate",
    "company",
    "job_title",
    "driver_license",
    "driver_state",
    "website",
    "fax_number",
    "notes",
    "uid",
    "updated_at",
    "created_at",
  ];
  const values = [
    email,
    first_name,
    middle_name,
    last_name,
    contact_group,
    mobile_phone,
    work_phone,
    home_phone,
    address_line,
    home_city,
    home_state,
    home_postal_code,
    home_country,
    timezone,
    birthdate,
    company,
    job_title,
    driver_license,
    driver_state,
    website,
    fax_number,
    notes,
    uid,
    updated_at,
    created_at,
  ];

  if (id != null && id !== "") {
    columns.unshift("id");
    values.unshift(id);
  }

  const placeholders = columns.map(() => "?").join(", ");
  const insertQuery = `INSERT INTO client (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${placeholders})`;

  db.query(
    insertQuery,
    values,
    (err, result) => {
      if (err) {
        console.error("Error creating client:", err);
        return res.status(500).send("Error creating client.");
      }
      res.status(201).send({ message: "Client created successfully", id: result.insertId });
    }
  );
});

// PUT /clients/:id – Update client
router.put("/clients/:id", (req, res) => {
  const clientId = req.params.id;
  const data = req.body;
  const address_line = `${data.home_street || ""} ${data.home_street_2 || ""}`.trim();

  const updatedFields = {
    email: data.email,
    first_name: data.first_name,
    middle_initial: data.middle_name,
    last_name: data.last_name,
    contact_group: data.contact_group,
    cell_phone_number: data.mobile_phone,
    work_phone_number: data.work_phone,
    home_phone_number: data.home_phone,
    address_line,
    city: data.home_city,
    state: data.home_state,
    zip_code: data.home_postal_code,
    country: data.home_country,
    timezone: data.timezone,
    birthdate: data.birthdate,
    company: data.company,
    job_title: data.job_title,
    driver_license: data.driver_license,
    driver_state: data.driver_state,
    website: data.website,
    fax_number: data.fax_number,
    notes: data.notes,
    uid: data.uid,
    updated_at: new Date(data.updated_at),
    created_at: new Date(data.created_at),
  };

  db.query("UPDATE client SET ? WHERE id = ?", [updatedFields, clientId], (err, result) => {
    if (err) {
      console.error("Error updating client:", err);
      return res.status(500).send("Error updating client.");
    }
    if (!result.affectedRows) return res.status(404).send("Client not found.");
    res.send("Client updated successfully.");
  });
});

// DELETE /clients/:id – Delete client
router.delete("/clients/:id", (req, res) => {
  const clientId = req.params.id;
  db.query("DELETE FROM client WHERE id = ?", [clientId], (err, result) => {
    if (err) {
      console.error("Error deleting client:", err);
      return res.status(500).send("Error deleting client.");
    }
    if (!result.affectedRows) return res.status(404).send("Client not found.");
    res.send("Client deleted successfully.");
  });
});

module.exports = router;