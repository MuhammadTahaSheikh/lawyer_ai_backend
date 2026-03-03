const express = require("express");
const router = express.Router();
const db = require("../db");
 
 
router.get("/companies", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const sort = req.query.sort || "created_at DESC";
 
  const conditions = [];
  const values = [];
 
  if (search) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
 
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countQuery = `SELECT COUNT(*) AS total FROM company ${whereClause}`;
  const companiesQuery = `
    SELECT * FROM company
    ${whereClause}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `;
 
  db.query(countQuery, values, (err, countResult) => {
    if (err) return res.status(500).send("Error counting companies.");
    const total = countResult[0]?.total || 0;
 
    db.query(companiesQuery, [...values, limit, offset], (err, companies) => {
      if (err) return res.status(500).send("Error fetching companies.");
 
      if (!companies.length) {
        return res.json({ total, companies: [] });
      }
 
      const companyIds = companies.map(c => c.id);
      const companyNames = companies.map(c => c.name);
      const idPlaceholders = companyIds.map(() => '?').join(',');
      const namePlaceholders = companyNames.map(() => '?').join(',');
 
      // --- Fetch all cases ---
      const casesQuery = `
        SELECT cc.company_id, cs.case_id, cs.name
        FROM company_case cc
        JOIN cases cs ON cc.case_id = cs.case_id
        WHERE cc.company_id IN (${idPlaceholders})
      `;
 
      db.query(casesQuery, companyIds, (err, caseResults = []) => {
        if (err) return res.status(500).send("Error fetching cases.");
 
        const groupedCases = {};
        for (const row of caseResults) {
          if (!groupedCases[row.company_id]) groupedCases[row.company_id] = [];
          groupedCases[row.company_id].push({ id: row.case_id, name: row.name });
        }
 
        // --- Fetch all clients from both sources ---
        const clientQuery = `
          SELECT
            c.id AS client_id,
            c.first_name,
            c.last_name,
            c.email,
            c.cell_phone_number,
            cc.company_id AS linked_company_id,
            cmp.id AS matched_company_id
          FROM client c
          LEFT JOIN company_client cc ON c.id = cc.client_id
          LEFT JOIN company cmp ON c.company = cmp.name
          WHERE cc.company_id IN (${idPlaceholders}) OR c.company IN (${namePlaceholders})
        `;
 
        db.query(clientQuery, [...companyIds, ...companyNames], (err, clientResults = []) => {
          if (err) return res.status(500).send("Error fetching clients.");
 
          const groupedClients = {};
 
          for (const client of clientResults) {
            const companyId = client.linked_company_id || client.matched_company_id;
            if (!companyId) continue;
 
            if (!groupedClients[companyId]) groupedClients[companyId] = [];
 
            // Prevent duplicates
            const exists = groupedClients[companyId].some(c => c.id === client.client_id);
            if (!exists) {
              groupedClients[companyId].push({
                id: client.client_id,
                first_name: client.first_name,
                last_name: client.last_name,
                name: `${client.first_name || ''} ${client.last_name || ''}`.trim(),
                email: client.email,
                phone: client.cell_phone_number
              });
            }
          }
 
          // Final company response
          const finalCompanies = companies.map(c => ({
            ...c,
            cases: groupedCases[c.id] || [],
            clients: groupedClients[c.id] || []
          }));
 
          res.json({ total, companies: finalCompanies });
        });
      });
    });
  });
});
 
 
 
 
 
 
// GET /companies/names - Return all company names for dropdowns
router.get("/companies/names", (req, res) => {
  const search = req.query.search || "";
  const searchClause = search ? "WHERE name LIKE ?" : "";
  const values = search ? [`%${search}%`] : [];
 
  const query = `
    SELECT id, name
    FROM company
    ${searchClause}
    ORDER BY name ASC
  `;
 
  db.query(query, values, (err, results) => {
    if (err) return res.status(500).send("Error fetching company names.");
    res.json(results);
  });
});
 
 
// 📘 GET /companies/:id
router.get("/companies/:id", (req, res) => {
  const id = req.params.id;
  db.query("SELECT * FROM company WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send("Error fetching company.");
    if (!result.length) return res.status(404).send("Company not found.");
    res.json(result[0]);
  });
});
 
// 🟢 POST /companies – Create
router.post("/companies", (req, res) => {
  const {
    id, name, email, website, notes, address1, address2,
    city, state, zip_code, country, main_phone_number,
    fax_phone_number, created_at, updated_at, archived
  } = req.body;
 
  const sql = `
    INSERT INTO company (
      id, name, email, website, notes,
      address1, address2, city, state, zip_code, country,
      main_phone_number, fax_phone_number, created_at, updated_at, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
 
  db.query(sql, [
    id, name, email, website, notes,
    address1, address2, city, state, zip_code, country,
    main_phone_number, fax_phone_number, created_at, updated_at, archived
  ], (err) => {
    if (err) return res.status(500).send("Error creating company.");
    res.status(201).json({ message: "Company created." });
  });
});
 
// 🟡 PUT /companies/:id – Update
router.put("/companies/:id", (req, res) => {
  const id = req.params.id;
 
  // 🧼 Remove non-column fields from the body
  const {
    cases,
    clients,
    ...data
  } = req.body;
 
  db.query("UPDATE company SET ? WHERE id = ?", [data, id], (err, result) => {
    if (err) {
      console.error("SQL Error:", err);
      return res.status(500).send("Error updating company.");
    }
 
    if (!result.affectedRows) {
      return res.status(404).send("Company not found.");
    }
 
    res.send("Company updated.");
  });
});
 
 
 
router.delete("/companies/:id", (req, res) => {
  const id = req.params.id;
  db.query("DELETE FROM company WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).send("Error deleting company.");
    if (!result.affectedRows) return res.status(404).send("Company not found.");
    res.send("Company deleted.");
  });
});
 
module.exports = router;
 
 