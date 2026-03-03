// routes/contacts.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /contacts – paginated and filtered contacts
router.get("/contacts", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 200;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";
  const sort = req.query.sort || "created_date DESC";
  let conditions = [];
  let values = [];
  if (search) {
    conditions.push("(first_name LIKE ? OR last_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalContactsQuery = `SELECT COUNT(*) AS totalContacts FROM contacts ${whereClause}`;
  const paginatedContactsQuery = `
    SELECT contact_id, first_name, last_name, case_name, email, created_date, created_by 
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
      res.json({ totalContacts, contacts: paginatedResults });
    });
  });
});

// GET /contacts/:id – fetch single contact
router.get("/contacts/:id", (req, res) => {
  const contactId = req.params.id;
  db.query("SELECT * FROM contacts WHERE contact_id = ?", [contactId], (err, result) => {
    if (err) return res.status(500).send("Error fetching contact.");
    if (!result.length) return res.status(404).send("Contact not found.");
    res.json(result[0]);
  });
});

// POST /contacts – create new contact
router.post("/contacts", (req, res) => {
  const uid = req.get("x-user-uid");
  if (!uid) {
    return res.status(400).json({ error: "Missing required header: x-user-uid" });
  }
  const {
    first_name, middle_name, last_name, company, job_title,
    home_street, home_street_2, home_city, home_state, home_postal_code,
    home_country, home_fax, work_phone, home_phone, mobile_phone,
    contact_group, email, birthday, private_notes, contact_notes,
    case_name, case_id, preferred_language, insurance_company,
    insured_property, brief_description_of_the_loss, mailing_address_if_different_from_above,
    have_the_claim_been_reported, policy_number, claim_number, date_of_loss,
    public_adjuster_if_applicable, created_date, created_by
  } = req.body;
  const insertQuery = `
    INSERT INTO contacts (
      first_name, middle_name, last_name, company, job_title, home_street, home_street_2,
      home_city, home_state, home_postal_code, home_country, home_fax, work_phone, home_phone,
      mobile_phone, contact_group, email, birthday, private_notes, contact_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(insertQuery, [
    first_name, middle_name, last_name, company, job_title, home_street, home_street_2,
    home_city, home_state, home_postal_code, home_country, home_fax, work_phone, home_phone,
    mobile_phone, contact_group, email, birthday, private_notes, contact_notes
  ], (err, result) => {
    if (err) {
      console.error("Error adding contact:", err);
      return res.status(500).send("Error adding contact.");
    }
    res.status(201).send({ id: result.insertId, ...req.body });
  });
});

// PUT /contacts/:id – update contact
router.put("/contacts/:id", (req, res) => {
  const uid = req.get("x-user-uid");
  if (!uid) {
    return res.status(400).json({ error: "Missing required header: x-user-uid" });
  }
  const contactId = req.params.id;
  const updatedFields = req.body;
  db.query("UPDATE contacts SET ? WHERE contact_id = ?", [updatedFields, contactId], (err, result) => {
    if (err) {
      console.error("Error updating contact:", err);
      return res.status(500).send("Error updating contact.");
    }
    if (!result.affectedRows) return res.status(404).send("Contact not found.");
    res.send("Contact updated successfully.");
  });
});

// DELETE /contacts/:id – delete contact
router.delete("/contacts/:id", (req, res) => {
  const contactId = req.params.id;
  db.query("DELETE FROM contacts WHERE contact_id = ?", [contactId], (err, result) => {
    if (err) {
      console.error("Error deleting contact:", err);
      return res.status(500).send("Error deleting contact.");
    }
    if (!result.affectedRows) return res.status(404).send("Contact not found.");
    res.send("Contact deleted successfully.");
  });
});

// GET /contacts/:id/cases – get associated cases for a contact
router.get("/contacts/:id/cases", (req, res) => {
  const contactId = req.params.id;
  const contactQuery = "SELECT case_id FROM contacts WHERE contact_id = ?";
  db.query(contactQuery, [contactId], (err, contactResult) => {
    if (err) {
      console.error("Error fetching contact's case IDs:", err);
      return res.status(500).send("Error fetching contact's case IDs.");
    }
    if (!contactResult.length || !contactResult[0].case_id) {
      return res.status(404).send("No associated cases found for this contact.");
    }
    const caseIds = contactResult[0].case_id.split(",").map(id => id.trim());
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

module.exports = router;