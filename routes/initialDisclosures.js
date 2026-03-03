// routes/initialDisclosures.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /initial-disclosures – fetch initial disclosure by case_id
router.get("/initial-disclosures", (req, res) => {
  const { case_id } = req.query;

  if (!case_id) {
    return res.status(400).json({ success: false, message: "case_id is required" });
  }

  const query = "SELECT * FROM initial_disclosures WHERE case_id = ? LIMIT 1";

  db.query(query, [case_id], (err, results) => {
    if (err) {
      console.error("Error fetching initial disclosure:", err);
      return res.status(500).json({ success: false, message: "Error fetching initial disclosure" });
    }

    if (results.length === 0) {
      return res.json({ success: true, data: null, message: "No initial disclosure found" });
    }

    // Parse restoration_companies JSON if it exists
    const data = results[0];
    if (data.restoration_companies && typeof data.restoration_companies === 'string') {
      try {
        data.restoration_companies = JSON.parse(data.restoration_companies);
      } catch (e) {
        console.error("Error parsing restoration_companies JSON:", e);
        data.restoration_companies = null;
      }
    }

    res.json({ success: true, data });
  });
});

// POST /initial-disclosures – create or update initial disclosure
router.post("/initial-disclosures", (req, res) => {
  // 🔍 DEBUG: Log raw request body
  console.log('═══════════════════════════════════════════');
  console.log('🐛 BACKEND DEBUG - Request Received');
  console.log('═══════════════════════════════════════════');
  console.log('📥 Full req.body keys:', Object.keys(req.body));
  
  const {
    case_id,
    client_name,
    client_phone_number,
    client_address,
    public_adjuster_name,
    public_adjuster_phone_number,
    public_adjuster_address,
    public_adjuster_description,
    loss_consultant_name,
    loss_consultant_phone_number,
    loss_consultant_address,
    loss_consultant_description,
    estimator_name,
    estimator_phone_number,
    estimator_address,
    estimator_description,
    restoration_companies,
    engineer_name,
    engineer_phone_number,
    engineer_address,
    engineer_description,
    corporate_representative_name,
    corporate_representative_phone_number,
    corporate_representative_address,
    corporate_representative_description,
    field_adjuster_name,
    field_adjuster_phone_number,
    field_adjuster_address,
    field_adjuster_description,
    uid
  } = req.body;

  // 🔍 DEBUG: Log description fields
  console.log('\n📝 Description Fields Received:');
  console.log('  public_adjuster_description:', public_adjuster_description ? `"${public_adjuster_description.substring(0, 50)}..." (${public_adjuster_description.length} chars)` : 'NULL/EMPTY');
  console.log('  loss_consultant_description:', loss_consultant_description ? `"${loss_consultant_description.substring(0, 50)}..." (${loss_consultant_description.length} chars)` : 'NULL/EMPTY');
  console.log('  estimator_description:', estimator_description ? `"${estimator_description.substring(0, 50)}..." (${estimator_description.length} chars)` : 'NULL/EMPTY');
  console.log('  engineer_description:', engineer_description ? `"${engineer_description.substring(0, 50)}..." (${engineer_description.length} chars)` : 'NULL/EMPTY');
  console.log('  corporate_representative_description:', corporate_representative_description ? `"${corporate_representative_description.substring(0, 50)}..." (${corporate_representative_description.length} chars)` : 'NULL/EMPTY');
  console.log('  field_adjuster_description:', field_adjuster_description ? `"${field_adjuster_description.substring(0, 50)}..." (${field_adjuster_description.length} chars)` : 'NULL/EMPTY');

  if (!case_id) {
    return res.status(400).json({ success: false, message: "case_id is required" });
  }

  // Check if record exists for this case_id
  const checkQuery = "SELECT id FROM initial_disclosures WHERE case_id = ? LIMIT 1";

  db.query(checkQuery, [case_id], (err, existing) => {
    if (err) {
      console.error("Error checking existing initial disclosure:", err);
      return res.status(500).json({ success: false, message: "Error checking existing record" });
    }

    // Convert restoration_companies to JSON string if it's an array/object
    const restorationCompaniesJson = restoration_companies 
      ? JSON.stringify(restoration_companies) 
      : null;

    if (existing.length > 0) {
      // Update existing record
      const updateQuery = `
        UPDATE initial_disclosures SET
          client_name = ?,
          client_phone_number = ?,
          client_address = ?,
          public_adjuster_name = ?,
          public_adjuster_phone_number = ?,
          public_adjuster_address = ?,
          public_adjuster_description = ?,
          loss_consultant_name = ?,
          loss_consultant_phone_number = ?,
          loss_consultant_address = ?,
          loss_consultant_description = ?,
          estimator_name = ?,
          estimator_phone_number = ?,
          estimator_address = ?,
          estimator_description = ?,
          restoration_companies = ?,
          engineer_name = ?,
          engineer_phone_number = ?,
          engineer_address = ?,
          engineer_description = ?,
          corporate_representative_name = ?,
          corporate_representative_phone_number = ?,
          corporate_representative_address = ?,
          corporate_representative_description = ?,
          field_adjuster_name = ?,
          field_adjuster_phone_number = ?,
          field_adjuster_address = ?,
          field_adjuster_description = ?,
          uid = ?,
          updated_at = NOW()
        WHERE case_id = ?
      `;

      const updateValues = [
        client_name || null,
        client_phone_number || null,
        client_address || null,
        public_adjuster_name || null,
        public_adjuster_phone_number || null,
        public_adjuster_address || null,
        public_adjuster_description || null,
        loss_consultant_name || null,
        loss_consultant_phone_number || null,
        loss_consultant_address || null,
        loss_consultant_description || null,
        estimator_name || null,
        estimator_phone_number || null,
        estimator_address || null,
        estimator_description || null,
        restorationCompaniesJson,
        engineer_name || null,
        engineer_phone_number || null,
        engineer_address || null,
        engineer_description || null,
        corporate_representative_name || null,
        corporate_representative_phone_number || null,
        corporate_representative_address || null,
        corporate_representative_description || null,
        field_adjuster_name || null,
        field_adjuster_phone_number || null,
        field_adjuster_address || null,
        field_adjuster_description || null,
        uid || null,
        case_id
      ];

      // 🔍 DEBUG: Log values being sent to SQL
      console.log('\n💾 Values being sent to UPDATE query:');
      console.log('  Position 6 (public_adjuster_description):', updateValues[6]);
      console.log('  Position 10 (loss_consultant_description):', updateValues[10]);
      console.log('  Position 14 (estimator_description):', updateValues[14]);
      console.log('  Position 19 (engineer_description):', updateValues[19]);
      console.log('  Position 23 (corporate_representative_description):', updateValues[23]);
      console.log('  Position 27 (field_adjuster_description):', updateValues[27]);

      db.query(updateQuery, updateValues, (err, result) => {
        if (err) {
          console.error("❌ Error updating initial disclosure:", err);
          return res.status(500).json({ success: false, message: "Error updating initial disclosure" });
        }

        console.log('✅ UPDATE successful, affected rows:', result.affectedRows);

        // Fetch updated record
        db.query("SELECT * FROM initial_disclosures WHERE case_id = ?", [case_id], (err, updated) => {
          if (err) {
            console.error("Error fetching updated record:", err);
            return res.status(500).json({ success: false, message: "Error fetching updated record" });
          }
          
          const data = updated[0];
          
          // 🔍 DEBUG: Log what came back from database
          console.log('\n📤 Description Fields Retrieved from DB:');
          console.log('  public_adjuster_description:', data.public_adjuster_description ? `"${data.public_adjuster_description.substring(0, 50)}..." (${data.public_adjuster_description.length} chars)` : 'NULL/EMPTY');
          console.log('  loss_consultant_description:', data.loss_consultant_description ? `"${data.loss_consultant_description.substring(0, 50)}..." (${data.loss_consultant_description.length} chars)` : 'NULL/EMPTY');
          console.log('  estimator_description:', data.estimator_description ? `"${data.estimator_description.substring(0, 50)}..." (${data.estimator_description.length} chars)` : 'NULL/EMPTY');
          console.log('  engineer_description:', data.engineer_description ? `"${data.engineer_description.substring(0, 50)}..." (${data.engineer_description.length} chars)` : 'NULL/EMPTY');
          console.log('  corporate_representative_description:', data.corporate_representative_description ? `"${data.corporate_representative_description.substring(0, 50)}..." (${data.corporate_representative_description.length} chars)` : 'NULL/EMPTY');
          console.log('  field_adjuster_description:', data.field_adjuster_description ? `"${data.field_adjuster_description.substring(0, 50)}..." (${data.field_adjuster_description.length} chars)` : 'NULL/EMPTY');
          console.log('═══════════════════════════════════════════\n');
          
          // Parse restoration_companies JSON if it exists
          if (data.restoration_companies && typeof data.restoration_companies === 'string') {
            try {
              data.restoration_companies = JSON.parse(data.restoration_companies);
            } catch (e) {
              console.error("Error parsing restoration_companies JSON:", e);
              data.restoration_companies = null;
            }
          }
          res.json({ success: true, data, message: "Initial disclosure updated successfully" });
        });
      });
    } else {
      // Insert new record
      const insertQuery = `
        INSERT INTO initial_disclosures (
          case_id,
          client_name,
          client_phone_number,
          client_address,
          public_adjuster_name,
          public_adjuster_phone_number,
          public_adjuster_address,
          public_adjuster_description,
          loss_consultant_name,
          loss_consultant_phone_number,
          loss_consultant_address,
          loss_consultant_description,
          estimator_name,
          estimator_phone_number,
          estimator_address,
          estimator_description,
          restoration_companies,
          engineer_name,
          engineer_phone_number,
          engineer_address,
          engineer_description,
          corporate_representative_name,
          corporate_representative_phone_number,
          corporate_representative_address,
          corporate_representative_description,
          field_adjuster_name,
          field_adjuster_phone_number,
          field_adjuster_address,
          field_adjuster_description,
          uid,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const insertValues = [
        case_id,
        client_name || null,
        client_phone_number || null,
        client_address || null,
        public_adjuster_name || null,
        public_adjuster_phone_number || null,
        public_adjuster_address || null,
        public_adjuster_description || null,
        loss_consultant_name || null,
        loss_consultant_phone_number || null,
        loss_consultant_address || null,
        loss_consultant_description || null,
        estimator_name || null,
        estimator_phone_number || null,
        estimator_address || null,
        estimator_description || null,
        restorationCompaniesJson,
        engineer_name || null,
        engineer_phone_number || null,
        engineer_address || null,
        engineer_description || null,
        corporate_representative_name || null,
        corporate_representative_phone_number || null,
        corporate_representative_address || null,
        corporate_representative_description || null,
        field_adjuster_name || null,
        field_adjuster_phone_number || null,
        field_adjuster_address || null,
        field_adjuster_description || null,
        uid || null
      ];

      // 🔍 DEBUG: Log values being sent to SQL
      console.log('\n💾 Values being sent to INSERT query:');
      console.log('  Position 7 (public_adjuster_description):', insertValues[7]);
      console.log('  Position 11 (loss_consultant_description):', insertValues[11]);
      console.log('  Position 15 (estimator_description):', insertValues[15]);
      console.log('  Position 20 (engineer_description):', insertValues[20]);
      console.log('  Position 24 (corporate_representative_description):', insertValues[24]);
      console.log('  Position 28 (field_adjuster_description):', insertValues[28]);

      db.query(insertQuery, insertValues, (err, result) => {
        if (err) {
          console.error("❌ Error creating initial disclosure:", err);
          return res.status(500).json({ success: false, message: "Error creating initial disclosure" });
        }

        console.log('✅ INSERT successful, insertId:', result.insertId);

        // Fetch created record
        db.query("SELECT * FROM initial_disclosures WHERE id = ?", [result.insertId], (err, created) => {
          if (err) {
            console.error("Error fetching created record:", err);
            return res.status(500).json({ success: false, message: "Error fetching created record" });
          }
          
          const data = created[0];
          
          // 🔍 DEBUG: Log what came back from database
          console.log('\n📤 Description Fields Retrieved from DB:');
          console.log('  public_adjuster_description:', data.public_adjuster_description ? `"${data.public_adjuster_description.substring(0, 50)}..." (${data.public_adjuster_description.length} chars)` : 'NULL/EMPTY');
          console.log('  loss_consultant_description:', data.loss_consultant_description ? `"${data.loss_consultant_description.substring(0, 50)}..." (${data.loss_consultant_description.length} chars)` : 'NULL/EMPTY');
          console.log('  estimator_description:', data.estimator_description ? `"${data.estimator_description.substring(0, 50)}..." (${data.estimator_description.length} chars)` : 'NULL/EMPTY');
          console.log('  engineer_description:', data.engineer_description ? `"${data.engineer_description.substring(0, 50)}..." (${data.engineer_description.length} chars)` : 'NULL/EMPTY');
          console.log('  corporate_representative_description:', data.corporate_representative_description ? `"${data.corporate_representative_description.substring(0, 50)}..." (${data.corporate_representative_description.length} chars)` : 'NULL/EMPTY');
          console.log('  field_adjuster_description:', data.field_adjuster_description ? `"${data.field_adjuster_description.substring(0, 50)}..." (${data.field_adjuster_description.length} chars)` : 'NULL/EMPTY');
          console.log('═══════════════════════════════════════════\n');
          
          // Parse restoration_companies JSON if it exists
          if (data.restoration_companies && typeof data.restoration_companies === 'string') {
            try {
              data.restoration_companies = JSON.parse(data.restoration_companies);
            } catch (e) {
              console.error("Error parsing restoration_companies JSON:", e);
              data.restoration_companies = null;
            }
          }
          res.status(201).json({ success: true, data, message: "Initial disclosure created successfully" });
        });
      });
    }
  });
});

// GET /initial-disclosures/:case_id – fetch initial disclosure by case_id
router.get("/initial-disclosures/:case_id", (req, res) => {
  const { case_id } = req.params;

  if (!case_id) {
    return res.status(400).json({ success: false, message: "case_id is required" });
  }

  const query = "SELECT * FROM initial_disclosures WHERE case_id = ? LIMIT 1";

  db.query(query, [case_id], (err, results) => {
    if (err) {
      console.error("Error fetching initial disclosure:", err);
      return res.status(500).json({ success: false, message: "Error fetching initial disclosure" });
    }

    if (results.length === 0) {
      return res.json({ success: true, data: null, message: "No initial disclosure found" });
    }

    const data = results[0];

    // auto-parse restoration_companies JSON if necessary
    if (data.restoration_companies && typeof data.restoration_companies === "string") {
      try {
        data.restoration_companies = JSON.parse(data.restoration_companies);
      } catch (e) {
        console.error("Error parsing restoration_companies JSON:", e);
        data.restoration_companies = null;
      }
    }

    return res.json({ success: true, data });
  });
});

module.exports = router;