// routes/automations.js
const express = require('express');
const axios = require('axios');
const { URLSearchParams } = require('url');
const router = express.Router();

const db = require('../db');
const crypto = require('crypto');

// Fetch NOI data
router.get('/noi', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch NOI called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch NOI called with caseId:', caseId);
  try {
    // Query all records for this case using promisePool
    const [rows] = await db.promisePool.execute(
      `SELECT
         claimant_name,
         defendant,
         policy_number,
         claim_number,
         pa_estimate,
         aob_dtp_invoice_amount,
         email,
         address,
         city,
         state,
         zip_code,
         attorney_first_name,
         attorney_last_name,
         generated_narrative,
         status, 
         coverage_determination,
         date_of_loss
       FROM noi_auto
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Query returned rows:', rows);

    // Return the pending record if present; otherwise return the first row or null
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch NOI data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert NOI data
router.post('/noi', async (req, res) => {
  console.log('📥 POST /automations/noi body:', req.body);
  const caseId = req.body.caseId ?? req.body.case_id;
  const claimant_name       = req.body.claimant_name       ?? null;
  const defendant           = req.body.defendant           ?? null;
  const policy_number       = req.body.policy_number       ?? null;
  const claim_number        = req.body.claim_number        ?? null;
  const pa_estimate         = req.body.pa_estimate         ?? null;
  const aob_dtp_invoice_amount = req.body.aob_dtp_invoice_amount ?? null;
  const email               = req.body.email               ?? null;
  const address             = req.body.address             ?? null;
  const city                = req.body.city                ?? null;
  const state               = req.body.state               ?? null;
  const zip_code            = req.body.zip_code            ?? null;
  const attorney_first_name = req.body.attorney_first_name ?? null;
  const attorney_last_name  = req.body.attorney_last_name  ?? null;
  const generated_narrative = req.body.generated_narrative ?? null;
  const coverage_determination  = req.body.coverage_determination ?? null;
  const date_of_loss  = req.body.date_of_loss ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Upsert using promisePool
    await db.promisePool.execute(
      `INSERT INTO noi_auto (
         case_id,
         claimant_name,
         defendant,
         policy_number,
         claim_number,
         pa_estimate,
         aob_dtp_invoice_amount,
         email,
         address,
         city,
         state,
         zip_code,
         attorney_first_name,
         attorney_last_name,
         generated_narrative,
         status,
         coverage_determination,
         date_of_loss
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         defendant            = VALUES(defendant),
         policy_number        = VALUES(policy_number),
         claim_number         = VALUES(claim_number),
         pa_estimate          = VALUES(pa_estimate),
         aob_dtp_invoice_amount = VALUES(aob_dtp_invoice_amount),
         claimant_name        = VALUES(claimant_name),
         email                = VALUES(email),
         address              = VALUES(address),
         city                 = VALUES(city),
         state                = VALUES(state),
         zip_code             = VALUES(zip_code),
         attorney_first_name  = VALUES(attorney_first_name),
         attorney_last_name   = VALUES(attorney_last_name),
         generated_narrative  = VALUES(generated_narrative),
         status               = VALUES(status), 
         coverage_determination = VALUES(coverage_determination),
         date_of_loss         = VALUES(date_of_loss)
      `,
      [
        caseId,
        claimant_name,
        defendant,
        policy_number,
        claim_number,
        pa_estimate,
        aob_dtp_invoice_amount,
        email,
        address,
        city,
        state,
        zip_code,
        attorney_first_name,
        attorney_last_name,
        generated_narrative,
        'pending',
        coverage_determination,
        date_of_loss
      ]
    );

    return res.json({ success: true, message: 'NOI data saved' });
  } catch (err) {
    console.error('❌  NOI data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
// Update NOI record status (accepts caseId or case_id, normalizes value)
router.put('/noi', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) {
      return res.status(400).json({ success: false, message: 'Missing caseId' });
    }
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Missing status' });
    }

    // Map common synonyms and enforce allowed enum values
    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE noi_auto SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated NOI status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'NOI status updated', status });
  } catch (err) {
    console.error('❌  Update NOI status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update NOI record status via explicit /noi/status path (same logic as PUT /noi)
router.put('/noi/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) {
      return res.status(400).json({ success: false, message: 'Missing caseId' });
    }
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Missing status' });
    }

    // Map common synonyms and enforce allowed enum values
    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE noi_auto SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated NOI status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'NOI status updated', status });
  } catch (err) {
    console.error('❌  Update NOI status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete NOI entries for a case
router.delete('/noi', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute(
      'DELETE FROM noi_auto WHERE case_id = ?',
      [caseId]
    );
    return res.status(200).json({ success: true, message: 'NOI entries deleted' });
  } catch (err) {
    console.error('❌  Delete NOI entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete NOI entries for a case by path parameter
router.delete('/noi/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute(
      'DELETE FROM noi_auto WHERE case_id = ?',
      [caseId]
    );
    return res.status(200).json({ success: true, message: 'NOI entries deleted' });
  } catch (err) {
    console.error('❌  Delete NOI entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger NOI automation via n8n
router.post('/noi/trigger', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  const n8nUrl = process.env.N8N_NOI_WEBHOOK_URL;
  console.log('▶️  Triggering NOI automation webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  NOI automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  NOI automation trigger error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger NOI automation', details: err.message });
  }
});

// Re-run NOI automation: clear existing and trigger again
router.post('/noi/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    // Delete any existing NOI entries
    await db.promisePool.execute(
      'DELETE FROM noi_auto WHERE case_id = ?',
      [caseId]
    );
    console.log('🗑️ Deleted existing NOI entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = process.env.N8N_NOI_WEBHOOK_URL;
    console.log('▶️ Re-triggering NOI automation webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run NOI automation triggered:', response.status);

    return res.json({ success: true, message: 'NOI re-run triggered' });
  } catch (err) {
    console.error('❌  NOI re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Retainer Automations
router.post('/retainer_follow_up_1', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_RETAINER_FOLLOW_UP_1_WEBHOOK_URL;
  console.log('▶️  Triggering Retainer Follow-Up 1 webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Retainer Follow-Up 1 response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Retainer Follow-Up 1 error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Retainer Follow-Up 1 automation' });
  }
});

router.post('/retainer_follow_up_2', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_RETAINER_FOLLOW_UP_2_WEBHOOK_URL;
  console.log('▶️  Triggering Retainer Follow-Up 2 webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Retainer Follow-Up 2 response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Retainer Follow-Up 2 error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Retainer Follow-Up 2 automation' });
  }
});

router.post('/retainer_follow_up_3', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_RETAINER_FOLLOW_UP_3_WEBHOOK_URL;
  console.log('▶️  Triggering Retainer Follow-Up 3 webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Retainer Follow-Up 3 response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Retainer Follow-Up 3 error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Retainer Follow-Up 3 automation' });
  }
});

// Estimate Automations
router.post('/estimate_request', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_ESTIMATE_REQUEST_WEBHOOK_URL;
  console.log('▶️  Triggering Estimate Request webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Estimate Request response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Estimate Request error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Estimate Request automation' });
  }
});

router.post('/estimate_follow_up', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_ESTIMATE_FOLLOW_UP_WEBHOOK_URL;
  console.log('▶️  Triggering Estimate Follow-Up webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Estimate Follow-Up response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Estimate Follow-Up error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Estimate Follow-Up automation' });
  }
});

// // LOR Automations
// router.post('/lor_to_client', async (req, res) => {
//   const { caseId } = req.body;
//   if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
//   const n8nUrl = process.env.N8N_LOR_TO_CLIENT_WEBHOOK_URL;
//   console.log('▶️  Triggering LOR to Client webhook:', n8nUrl, 'with caseId:', caseId);
//   try {
//     const response = await axios.post(n8nUrl, { caseId });
//     console.log('✅  LOR to Client response:', response.status, response.data);
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error('❌  LOR to Client error:', { message: err.message, status: err.response?.status, data: err.response?.data });
//     return res.status(500).json({ success: false, message: 'Failed to trigger LOR to Client automation' });
//   }
// });

// router.post('/lor_to_carrier', async (req, res) => {
//   const { caseId } = req.body;
//   if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
//   const n8nUrl = process.env.N8N_LOR_TO_CARRIER_WEBHOOK_URL;
//   console.log('▶️  Triggering LOR to Carrier webhook:', n8nUrl, 'with caseId:', caseId);
//   try {
//     const response = await axios.post(n8nUrl, { caseId });
//     console.log('✅  LOR to Carrier response:', response.status, response.data);
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error('❌  LOR to Carrier error:', { message: err.message, status: err.response?.status, data: err.response?.data });
//     return res.status(500).json({ success: false, message: 'Failed to trigger LOR to Carrier automation' });
//   }
// });

// Policy Request Automations
router.post('/certified_policy_request', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_CERTIFIED_POLICY_REQUEST_WEBHOOK_URL;
  console.log('▶️  Triggering Certified Policy Request webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Certified Policy Request response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Certified Policy Request error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Certified Policy Request automation' });
  }
});

router.post('/certified_policy_follow_up', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_CERTIFIED_POLICY_FOLLOW_UP_WEBHOOK_URL;
  console.log('▶️  Triggering Certified Policy Follow-Up webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Certified Policy Follow-Up response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Certified Policy Follow-Up error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Certified Policy Follow-Up automation' });
  }
});


router.post('/submit_dfs_complaint', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_SUBMIT_DFS_COMPLAINT_WEBHOOK_URL;
  console.log('▶️  Triggering Submit DFS Complaint webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Submit DFS Complaint response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Submit DFS Complaint error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Submit DFS Complaint automation' });
  }
});

// Settlement Automations
router.post('/settlement_demand', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_SETTLEMENT_DEMAND_WEBHOOK_URL;
  console.log('▶️  Triggering Settlement Demand webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Settlement Demand response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Settlement Demand error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Settlement Demand automation' });
  }
});

router.post('/settlement_follow_up', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_SETTLEMENT_FOLLOW_UP_WEBHOOK_URL;
  console.log('▶️  Triggering Settlement Follow-Up webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Settlement Follow-Up response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Settlement Follow-Up error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Settlement Follow-Up automation' });
  }
});

// Dispute Resolution Automations
router.post('/request_dfs_mediation', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_REQUEST_DFS_MEDIATION_WEBHOOK_URL;
  console.log('▶️  Triggering Request DFS Mediation webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Request DFS Mediation response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Request DFS Mediation error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Request DFS Mediation automation' });
  }
});


router.post('/request_appraisal', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_REQUEST_APPRAISAL_WEBHOOK_URL;
  console.log('▶️  Triggering Request Appraisal webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Request Appraisal response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Request Appraisal error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger Request Appraisal automation' });
  }
});

// ==============================
// DFS Mediation (dfs_auto) CRUD & triggers
// ==============================

// Fetch DFS data
router.get('/dfs', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch DFS called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch DFS called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         email,
         client_first_name,
         client_last_name,
         client_phone_number,
         client_address,
         client_zip_code,
         client_city,
         policy_number,
         claim_number,
         date_of_loss,
         insurance_company,
         paralegal_email,
         attorney_email,
         attorney_last_name,
         generated_narrative,
         uid,
         uipath_uid,
         status,
         created_at,
     updated_at
       FROM dfs_auto
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 DFS query returned rows:', rows);

    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected DFS record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch DFS data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert DFS data
router.post('/dfs', async (req, res) => {
  console.log('📥 POST /automations/dfs body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 DFS upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const email = req.body.email ?? null;
  const client_first_name = req.body.client_first_name ?? req.body.clientFirstName ?? null;
  const client_last_name = req.body.client_last_name ?? req.body.clientLastName ?? null;
  const client_phone_number = req.body.client_phone_number ?? req.body.clientPhoneNumber ?? null;
  const client_address = req.body.client_address ?? req.body.clientAddress ?? null;
  const client_zip_code = req.body.client_zip_code ?? req.body.clientZipCode ?? null;
  const client_city = req.body.client_city ?? req.body.clientCity ?? null;
  const policy_number = req.body.policy_number ?? req.body.policyNumber ?? null;
  const claim_number = req.body.claim_number ?? req.body.claimNumber ?? null;
  const insurance_company = req.body.insurance_company ?? req.body.insuranceCompany ?? null;
  const paralegal_email = req.body.paralegal_email ?? req.body.paralegalEmail ?? null;
  const attorney_email = req.body.attorney_email ?? req.body.attorneyEmail ?? null;
  const attorney_last_name = req.body.attorney_last_name ?? req.body.attorneyLastName ?? null;
  const date_of_loss = req.body.date_of_loss ?? req.body.dateOfLoss ?? null;
  const generated_narrative = req.body.generated_narrative ?? req.body.generatedNarrative ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO dfs_auto (
         case_id,
         uid,
         email,
         client_first_name,
         client_last_name,
         client_phone_number,
         client_address,
         client_zip_code,
         client_city,
         policy_number,
         claim_number,
         date_of_loss,
         insurance_company,
         paralegal_email,
         attorney_email,
         attorney_last_name,
         generated_narrative,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         NOW(),
       NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid = VALUES(uid),
         email = VALUES(email),
         client_first_name = VALUES(client_first_name),
         client_last_name = VALUES(client_last_name),
         client_phone_number = VALUES(client_phone_number),
         client_address = VALUES(client_address),
         client_zip_code = VALUES(client_zip_code),
         client_city = VALUES(client_city),
         policy_number = VALUES(policy_number),
         claim_number = VALUES(claim_number),
         date_of_loss = VALUES(date_of_loss),
         insurance_company = VALUES(insurance_company),
         paralegal_email = VALUES(paralegal_email),
         attorney_email = VALUES(attorney_email),
         attorney_last_name = VALUES(attorney_last_name),
         generated_narrative = VALUES(generated_narrative),
         status = VALUES(status),
         updated_at = NOW()
      `,
      [
        caseId,
        uid,
        email,
        client_first_name,
        client_last_name,
        client_phone_number,
        client_address,
        client_zip_code,
        client_city,
        policy_number,
        claim_number,
        date_of_loss,
        insurance_company,
        paralegal_email,
        attorney_email,
        attorney_last_name,
        generated_narrative,
        'pending'
      ]
    );

    return res.json({ success: true, message: 'DFS data saved' });
  } catch (err) {
    console.error('❌  DFS data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update DFS record status
router.put('/dfs', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) {
      return res.status(400).json({ success: false, message: 'Missing caseId' });
    }
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Missing status' });
    }

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE dfs_auto SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated DFS status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'DFS status updated', status });
  } catch (err) {
    console.error('❌  Update DFS status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/dfs/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) {
      return res.status(400).json({ success: false, message: 'Missing caseId' });
    }
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Missing status' });
    }

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE dfs_auto SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated DFS status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'DFS status updated', status });
  } catch (err) {
    console.error('❌  Update DFS status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete DFS entries for a case (query param)
router.delete('/dfs', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute(
      'DELETE FROM dfs_auto WHERE case_id = ?',
      [caseId]
    );
    return res.status(200).json({ success: true, message: 'DFS entries deleted' });
  } catch (err) {
    console.error('❌  Delete DFS entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete DFS entries for a case (path param)
router.delete('/dfs/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute(
      'DELETE FROM dfs_auto WHERE case_id = ?',
      [caseId]
    );
    return res.status(200).json({ success: true, message: 'DFS entries deleted' });
  } catch (err) {
    console.error('❌  Delete DFS entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger DFS mediation via n8n
router.post('/dfs/trigger', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  const n8nUrl = process.env.N8N_REQUEST_DFS_MEDIATION_WEBHOOK_URL;
  console.log('▶️  Triggering DFS mediation webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  DFS mediation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  DFS mediation trigger error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger DFS mediation', details: err.message });
  }
});

// Re-run DFS mediation: clear existing and trigger again
router.post('/dfs/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute('DELETE FROM dfs_auto WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing DFS entries for caseId', caseId);

    const n8nUrl = process.env.N8N_REQUEST_DFS_MEDIATION_WEBHOOK_URL;
    console.log('▶️ Re-triggering DFS mediation webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run DFS mediation triggered:', response.status);

    return res.json({ success: true, message: 'DFS re-run triggered' });
  } catch (err) {
    console.error('❌  DFS re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});



// (Optional) Enqueue DFS item in UiPath Orchestrator
router.post('/dfs/queue', async (req, res) => {
  const {
    caseId,
uid,
    email,
    client_first_name,
    client_last_name,
    client_phone_number,
    client_address,
    client_zip_code,
    client_city,
    policy_number,
    claim_number,
    date_of_loss,
    insurance_company,
    paralegal_email,
    attorney_email,
    attorney_last_name,
    generated_narrative
  } = req.body;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // set status to loading
// set status to loading + ET timestamps
try {
    await db.promisePool.execute(
      'UPDATE dfs_auto SET status = ?,  uipath_uid = ?, updated_at = NOW() WHERE case_id = ?', 
      ['loading', uid, caseId] // Using same uid for both fields for now
    );
    console.log('💾 DFS status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing DFS:', e.message);
  }


  try {
    console.log('▶️  Requesting UiPath token for DFS queue');
    const resp = await axios.post(
      process.env.UIPATH_TOKEN_URL,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     process.env.UIPATH_DFS_CLIENT_ID,
        client_secret: process.env.UIPATH_DFS_CLIENT_SECRET,
        scope:         process.env.UIPATH_TOKEN_SCOPE,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = resp.data.access_token;

    console.log('🔧 DFS Orchestrator Config:', {
      orchUrl: process.env.UIPATH_ORCH_DFS_URL,
      folderId: process.env.UIPATH_DFS_FOLDER_ID,
      queueName: process.env.UIPATH_DFS_QUEUE_NAME,
    });

    const itemData = {
      Name: process.env.UIPATH_DFS_QUEUE_NAME,
      Priority: 'High',
      SpecificContent: {
        caseId,
        email,
        client_first_name,
        client_last_name,
        client_phone_number,
        client_address,
        client_zip_code,
        client_city,
        policy_number,
        claim_number,
        date_of_loss,
        insurance_company,
        paralegal_email,
        attorney_email,
        attorney_last_name,
        generated_narrative
      },
      DeferDate: new Date().toISOString()
    };

    const queueResp = await axios.post(
      `${process.env.UIPATH_ORCH_DFS_URL}/odata/Queues/UiPathODataSvc.AddQueueItem`,
      { itemData },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-UIPATH-OrganizationUnitId': process.env.UIPATH_DFS_FOLDER_ID,
          'X-UIPATH-TenantName': process.env.UIPATH_TENANT
        }
      }
    );

    console.log('✅ DFS AddQueueItem response:', queueResp.data);
    return res.json({ success: true, data: queueResp.data });
  } catch (err) {
    console.error('❌ DFS AddQueueItem error for caseId', caseId, ':', err.response?.data || err.message);
    if (err.response && err.response.headers) {
      console.error('🔍 Response status:', err.response.status);
      console.error('🔍 Response headers:', err.response.headers);
      console.error('🔍 www-authenticate header:', err.response.headers['www-authenticate']);
      console.error('🔍 x-uipath-correlation-id:', err.response.headers['x-uipath-correlation-id']);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});


// ==============================
// Turndown Letter to Client (DOAH) (doah-letter) CRUD & UiPath queue
// ==============================

// Fetch DOAH Letter data
router.get('/doah-letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch DOAH called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch DOAH called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         client_name,
         address,
         email,
         date_of_loss,
         policy_number,
         claim_number,
         uid,
         uipath_uid,
         rerun_uid,
         firsttrigger_uid,
         status,
         created_at,
         updated_at
       FROM \`doah-letter\`
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 DOAH query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected DOAH record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch DOAH data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert DOAH Letter data
router.post('/doah-letter', async (req, res) => {
  console.log('📥 POST /automations/doah-letter body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 DOAH upsert uid:', uid);

  const caseId           = req.body.caseId ?? req.body.case_id;
  const client_name      = req.body.client_name ?? null;
  const address          = req.body.address ?? null;
  const email            = req.body.email ?? null;
  const date_of_loss     = req.body.date_of_loss ?? null;
  const policy_number    = req.body.policy_number ?? null;
  const claim_number     = req.body.claim_number ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO \`doah-letter\` (
         case_id,
         uid,
         client_name,
         address,
         email,
         date_of_loss,
         policy_number,
         claim_number,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid              = VALUES(uid),
         client_name      = VALUES(client_name),
         address          = VALUES(address),
         email            = VALUES(email),
         date_of_loss     = VALUES(date_of_loss),
         policy_number    = VALUES(policy_number),
         claim_number     = VALUES(claim_number),
         updated_at       = NOW()
      `,
      [
        caseId,
        uid,
        client_name,
        address,
        email,
        date_of_loss,
        policy_number,
        claim_number
      ]
    );

    return res.json({ success: true, message: 'DOAH Letter data saved' });
  } catch (err) {
    console.error('❌  DOAH data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update DOAH Letter status
router.put('/doah-letter', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE `doah-letter` SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated DOAH status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'DOAH Letter status updated', status });
  } catch (err) {
    console.error('❌  Update DOAH status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/doah-letter/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE `doah-letter` SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated DOAH status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'DOAH Letter status updated', status });
  } catch (err) {
    console.error('❌  Update DOAH status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete DOAH Letter entries
router.delete('/doah-letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM `doah-letter` WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'DOAH Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete DOAH entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/doah-letter/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM `doah-letter` WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'DOAH Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete DOAH entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger DOAH Letter via n8n
router.post('/doah-letter/trigger', async (req, res) => {
  // --- Caller audit for DOAH trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 DOAH /doah-letter/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log DOAH trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/doah-letter';
  console.log('▶️  Triggering DOAH Letter webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  DOAH Letter automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  DOAH Letter trigger error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger DOAH Letter automation', details: err.message });
  }
});

// Re-run DOAH Letter: clear existing and trigger again via n8n
router.post('/doah-letter/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing DOAH Letter entries for this case
    await db.promisePool.execute('DELETE FROM `doah-letter` WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing DOAH Letter entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/doah-letter';
    if (!n8nUrl) {
      console.error('❌  DOAH webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering DOAH Letter webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run DOAH Letter automation triggered:', response.status);

    return res.json({ success: true, message: 'DOAH Letter re-run triggered' });
  } catch (err) {
    console.error('❌  DOAH Letter re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Enqueue DOAH Letter in UiPath Orchestrator
router.post('/doah-letter/queue', async (req, res) => {
  const {
    caseId,
    uid,
    client_name,
    address,
    email,
    date_of_loss,
    policy_number,
    claim_number
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE `doah-letter` SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 DOAH status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing DOAH:', e.message);
  }

  try {
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/doah-letter-email';
    console.log('▶️  Submitting DOAH Letter to n8n webhook:', n8nUrl, 'with caseId:', caseId);

    const payload = {
      caseId,
      client_name,
      address,
      email,
      date_of_loss,
      policy_number,
      claim_number
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  DOAH Letter submitted to n8n:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ DOAH submit to n8n error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit DOAH Letter to n8n', details: err.message });
  }
});



// ==============================
// LOR to Client (lor_to_client) CRUD & UiPath queue
// ==============================

// Fetch LOR to Client data
router.get('/lor_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch LOR to Client called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch LOR to Client called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         public_adjuster_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM lor_to_client
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 LOR to Client query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected LOR to Client record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch LOR to Client data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
// Upsert LOR to Client data
router.post('/lor_to_client', async (req, res) => {
  console.log('📥 POST /automations/lor_to_client body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 LOR to Client upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const loss_type = req.body.loss_type ?? null;
  const client_email = req.body.client_email ?? null;
  const attorney_email = req.body.attorney_email ?? null;
  const paralegal_email = req.body.paralegal_email ?? null;
  const public_adjuster_email = req.body.public_adjuster_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO lor_to_client (
         case_id,
         uid,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         public_adjuster_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                  = VALUES(uid),
         claim_number         = VALUES(claim_number),
         policy_number        = VALUES(policy_number),
         premises             = VALUES(premises),
         date_of_loss         = VALUES(date_of_loss),
         loss_type            = VALUES(loss_type),
         client_email         = VALUES(client_email),
         attorney_email       = VALUES(attorney_email),
         paralegal_email      = VALUES(paralegal_email),
         public_adjuster_email = VALUES(public_adjuster_email),
         status               = VALUES(status),
         updated_at           = NOW()
      `,
      [
        caseId,
        uid,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        client_email,
        attorney_email,
        paralegal_email,
        public_adjuster_email
      ]
    );

    return res.json({ success: true, message: 'LOR to Client data saved' });
  } catch (err) {
    console.error('❌  LOR to Client data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update LOR to Client status
router.put('/lor_to_client', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_client SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to Client status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to Client status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to Client status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/lor_to_client/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_client SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to Client status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to Client status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to Client status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete LOR to Client entries
router.delete('/lor_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_client WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to Client entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to Client entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/lor_to_client/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_client WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to Client entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to Client entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger LOR to Client via n8n
router.post('/lor_to_client/trigger', async (req, res) => {
  // --- Caller audit for LOR to Client trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 LOR to Client /lor_to_client/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log LOR to Client trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-client';
  console.log('▶️  Triggering LOR to Client webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  LOR to Client automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  LOR to Client trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger LOR to Client automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  LOR to Client trigger error:', errorData || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger LOR to Client automation', details: err.message });
  }
});

// Re-run LOR to Client: clear existing and trigger again via n8n
router.post('/lor_to_client/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing LOR to Client entries for this case
    await db.promisePool.execute('DELETE FROM lor_to_client WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing LOR to Client entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook-test/lor-to-client';
    if (!n8nUrl) {
      console.error('❌  LOR to Client webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering LOR to Client webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run LOR to Client automation triggered:', response.status);

    return res.json({ success: true, message: 'LOR to Client re-run triggered' });
  } catch (err) {
    console.error('❌  LOR to Client re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit LOR to Client to UiPath via n8n webhook
router.post('/lor_to_client/queue', async (req, res) => {
  const {
    caseId,
    uid,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    loss_type,
    client_email,
    attorney_email,
    paralegal_email,
    public_adjuster_email
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE lor_to_client SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 LOR to Client status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing LOR to Client:', e.message);
  }

  // Use hardcoded n8n webhook URL for UiPath submission
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-client-email';
  console.log('▶️  Submitting LOR to Client to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const payload = {
      caseId,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      loss_type,
      client_email,
      attorney_email,
      paralegal_email,
      public_adjuster_email,
      uid
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ LOR to Client UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ LOR to Client UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit LOR to Client to UiPath', details: err.message });
  }
});

// ==============================
// Estimate Request Form (estimate_request_form) CRUD & UiPath queue
// ==============================

// Fetch Estimate Request Form data
router.get('/estimate_request_form', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Estimate Request Form called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Estimate Request Form called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         plaintiff,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         insurance_company,
         client_phone,
         send_to,
         public_adjuster,
         uid,
         uipath_uid,
         rerun_uid,
         firsttrigger_uid,
         status,
         created_at,
         updated_at
       FROM estimate_request_form
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Estimate Request Form query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected Estimate Request Form record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Estimate Request Form data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Estimate Request Form data
router.post('/estimate_request_form', async (req, res) => {
  console.log('📥 POST /automations/estimate_request_form body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Estimate Request Form upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const plaintiff = req.body.plaintiff ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const loss_type = req.body.loss_type ?? null;
  const insurance_company = req.body.insurance_company ?? null;
  const client_phone = req.body.client_phone ?? null;
  const send_to = req.body.send_to ?? null;
  const public_adjuster = req.body.public_adjuster ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO estimate_request_form (
         case_id,
         uid,
         plaintiff,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         insurance_company,
         client_phone,
         send_to,
         public_adjuster,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                  = VALUES(uid),
         plaintiff            = VALUES(plaintiff),
         claim_number         = VALUES(claim_number),
         policy_number        = VALUES(policy_number),
         premises             = VALUES(premises),
         date_of_loss         = VALUES(date_of_loss),
         loss_type            = VALUES(loss_type),
         insurance_company    = VALUES(insurance_company),
         client_phone         = VALUES(client_phone),
         send_to              = VALUES(send_to),
         public_adjuster      = VALUES(public_adjuster),
         updated_at           = NOW()
      `,
      [
        caseId,
        uid,
        plaintiff,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        insurance_company,
        client_phone,
        send_to,
        public_adjuster
      ]
    );

    return res.json({ success: true, message: 'Estimate Request Form data saved' });
  } catch (err) {
    console.error('❌  Estimate Request Form data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Estimate Request Form status
router.put('/estimate_request_form', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE estimate_request_form SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Estimate Request Form status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Estimate Request Form status updated', status });
  } catch (err) {
    console.error('❌  Update Estimate Request Form status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/estimate_request_form/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE estimate_request_form SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Estimate Request Form status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Estimate Request Form status updated', status });
  } catch (err) {
    console.error('❌  Update Estimate Request Form status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Estimate Request Form entries
router.delete('/estimate_request_form', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM estimate_request_form WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Estimate Request Form entries deleted' });
  } catch (err) {
    console.error('❌  Delete Estimate Request Form entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/estimate_request_form/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM estimate_request_form WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Estimate Request Form entries deleted' });
  } catch (err) {
    console.error('❌  Delete Estimate Request Form entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Estimate Request Form via n8n
router.post('/estimate_request_form/trigger', async (req, res) => {
  // --- Caller audit for Estimate Request Form trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 Estimate Request Form /estimate_request_form/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log Estimate Request Form trigger caller info:', logErr.message);
  }

  const { caseId, uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/request-form';
  console.log('▶️  Triggering Estimate Request Form webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    // Store firsttrigger_uid if provided
    if (uid) {
      try {
        await db.promisePool.execute(
          'UPDATE estimate_request_form SET firsttrigger_uid = ? WHERE case_id = ?',
          [uid, caseId]
        );
      } catch (e) {
        console.warn('⚠️ Failed to store firsttrigger_uid:', e.message);
      }
    }

    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Estimate Request Form automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  Estimate Request Form trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger Estimate Request Form automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  Estimate Request Form trigger error:', errorData || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Estimate Request Form automation', details: err.message });
  }
});

// Re-run Estimate Request Form: clear existing and trigger again via n8n
router.post('/estimate_request_form/rerun', async (req, res) => {
  const { caseId, uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Store rerun_uid if provided
    if (uid) {
      try {
        await db.promisePool.execute(
          'UPDATE estimate_request_form SET rerun_uid = ? WHERE case_id = ?',
          [uid, caseId]
        );
      } catch (e) {
        console.warn('⚠️ Failed to store rerun_uid:', e.message);
      }
    }

    // Delete any existing Estimate Request Form entries for this case
    await db.promisePool.execute('DELETE FROM estimate_request_form WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Estimate Request Form entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/request-form';
    if (!n8nUrl) {
      console.error('❌  Estimate Request Form webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering Estimate Request Form webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Estimate Request Form automation triggered:', response.status);

    return res.json({ success: true, message: 'Estimate Request Form re-run triggered' });
  } catch (err) {
    console.error('❌  Estimate Request Form re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit Estimate Request Form to UiPath via n8n webhook
router.post('/estimate_request_form/queue', async (req, res) => {
  const {
    caseId,
    uid,
    plaintiff,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    loss_type,
    insurance_company,
    client_phone,
    send_to,
    public_adjuster
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  const uipath_uid = uid ?? null;
  try {
    await db.promisePool.execute(
      'UPDATE estimate_request_form SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uipath_uid, caseId]
    );
    console.log('💾 Estimate Request Form status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing Estimate Request Form:', e.message);
  }

  // Use hardcoded n8n webhook URL for UiPath submission
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/estimate-request-email';
  console.log('▶️  Submitting Estimate Request Form to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const payload = {
      caseId,
      plaintiff,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      loss_type,
      insurance_company,
      client_phone,
      send_to,
      public_adjuster,
      uid,
      uipath_uid
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ Estimate Request Form UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Estimate Request Form UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit Estimate Request Form to UiPath', details: err.message });
  }
});

// ==============================
// Undisputed Payment Letter (undisputed_payment_letter) CRUD & UiPath queue
// ==============================

// Fetch Undisputed Payment Letter data
router.get('/undisputed_payment_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Undisputed Payment Letter called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Undisputed Payment Letter called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         plaintiff,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         insurance_company,
         client_phone,
         send_to,
         public_adjuster,
         uid,
         uipath_uid,
         rerun_uid,
         firsttrigger_uid,
         status,
         created_at,
         updated_at
       FROM undisputed_payment_letter
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Undisputed Payment Letter query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected Undisputed Payment Letter record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Undisputed Payment Letter data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Undisputed Payment Letter data
router.post('/undisputed_payment_letter', async (req, res) => {
  console.log('📥 POST /automations/undisputed_payment_letter body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Undisputed Payment Letter upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const plaintiff = req.body.plaintiff ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const loss_type = req.body.loss_type ?? null;
  const insurance_company = req.body.insurance_company ?? null;
  const client_phone = req.body.client_phone ?? null;
  const send_to = req.body.send_to ?? null;
  const public_adjuster = req.body.public_adjuster ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO undisputed_payment_letter (
         case_id,
         uid,
         plaintiff,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         insurance_company,
         client_phone,
         send_to,
         public_adjuster,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                  = VALUES(uid),
         plaintiff            = VALUES(plaintiff),
         claim_number         = VALUES(claim_number),
         policy_number        = VALUES(policy_number),
         premises             = VALUES(premises),
         date_of_loss         = VALUES(date_of_loss),
         loss_type            = VALUES(loss_type),
         insurance_company    = VALUES(insurance_company),
         client_phone         = VALUES(client_phone),
         send_to              = VALUES(send_to),
         public_adjuster      = VALUES(public_adjuster),
         updated_at           = NOW()
      `,
      [
        caseId,
        uid,
        plaintiff,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        insurance_company,
        client_phone,
        send_to,
        public_adjuster
      ]
    );

    return res.json({ success: true, message: 'Undisputed Payment Letter data saved' });
  } catch (err) {
    console.error('❌  Undisputed Payment Letter data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Undisputed Payment Letter status
router.put('/undisputed_payment_letter', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE undisputed_payment_letter SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Undisputed Payment Letter status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Undisputed Payment Letter status updated', status });
  } catch (err) {
    console.error('❌  Update Undisputed Payment Letter status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/undisputed_payment_letter/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE undisputed_payment_letter SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Undisputed Payment Letter status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Undisputed Payment Letter status updated', status });
  } catch (err) {
    console.error('❌  Update Undisputed Payment Letter status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Undisputed Payment Letter entries
router.delete('/undisputed_payment_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM undisputed_payment_letter WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Undisputed Payment Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete Undisputed Payment Letter entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/undisputed_payment_letter/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM undisputed_payment_letter WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Undisputed Payment Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete Undisputed Payment Letter entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Undisputed Payment Letter via n8n
router.post('/undisputed_payment_letter/trigger', async (req, res) => {
  // --- Caller audit for Undisputed Payment Letter trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 Undisputed Payment Letter /undisputed_payment_letter/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log Undisputed Payment Letter trigger caller info:', logErr.message);
  }

  const { caseId, uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/undisputed-payment-letter';
  console.log('▶️  Triggering Undisputed Payment Letter webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    // Store firsttrigger_uid if provided
    if (uid) {
      try {
        await db.promisePool.execute(
          'UPDATE undisputed_payment_letter SET firsttrigger_uid = ? WHERE case_id = ?',
          [uid, caseId]
        );
      } catch (e) {
        console.warn('⚠️ Failed to store firsttrigger_uid:', e.message);
      }
    }

    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Undisputed Payment Letter automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  Undisputed Payment Letter trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger Undisputed Payment Letter automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  Undisputed Payment Letter trigger error:', errorData || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Undisputed Payment Letter automation', details: err.message });
  }
});

// Re-run Undisputed Payment Letter: clear existing and trigger again via n8n
router.post('/undisputed_payment_letter/rerun', async (req, res) => {
  const { caseId, uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Store rerun_uid if provided
    if (uid) {
      try {
        await db.promisePool.execute(
          'UPDATE undisputed_payment_letter SET rerun_uid = ? WHERE case_id = ?',
          [uid, caseId]
        );
      } catch (e) {
        console.warn('⚠️ Failed to store rerun_uid:', e.message);
      }
    }

    // Delete any existing Undisputed Payment Letter entries for this case
    await db.promisePool.execute('DELETE FROM undisputed_payment_letter WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Undisputed Payment Letter entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/undisputed-payment-letter';
    if (!n8nUrl) {
      console.error('❌  Undisputed Payment Letter webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering Undisputed Payment Letter webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Undisputed Payment Letter automation triggered:', response.status);

    return res.json({ success: true, message: 'Undisputed Payment Letter re-run triggered' });
  } catch (err) {
    console.error('❌  Undisputed Payment Letter re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit Undisputed Payment Letter to UiPath via n8n webhook
router.post('/undisputed_payment_letter/queue', async (req, res) => {
  const {
    caseId,
    uid,
    plaintiff,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    loss_type,
    insurance_company,
    client_phone,
    send_to,
    public_adjuster,
     documents  
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  const uipath_uid = uid ?? null;
  try {
    await db.promisePool.execute(
      'UPDATE undisputed_payment_letter SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uipath_uid, caseId]
    );
    console.log('💾 Undisputed Payment Letter status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing Undisputed Payment Letter:', e.message);
  }

  // Use hardcoded n8n webhook URL for UiPath submission
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/undisputed-letter-email';
  console.log('▶️  Submitting Undisputed Payment Letter to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const payload = {
      caseId,
      plaintiff,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      loss_type,
      insurance_company,
      client_phone,
      send_to,
      public_adjuster,
      uid,
      uipath_uid,
        documents: documents || [] 

    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ Undisputed Payment Letter UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Undisputed Payment Letter UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit Undisputed Payment Letter to UiPath', details: err.message });
  }
});

// ==============================
// LOR to IC (lor_to_ic) CRUD & UiPath queue
// ==============================

// Fetch LOR to IC data
router.get('/lor_to_ic', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch LOR to IC called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch LOR to IC called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM lor_to_ic
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 LOR to IC query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected LOR to IC record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch LOR to IC data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert LOR to IC data
router.post('/lor_to_ic', async (req, res) => {
  console.log('📥 POST /automations/lor_to_ic body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 LOR to IC upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const loss_type = req.body.loss_type ?? null;
  const client_email = req.body.client_email ?? null;
  const attorney_email = req.body.attorney_email ?? null;
  const paralegal_email = req.body.paralegal_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO lor_to_ic (
         case_id,
         uid,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                  = VALUES(uid),
         claim_number         = VALUES(claim_number),
         policy_number        = VALUES(policy_number),
         premises             = VALUES(premises),
         date_of_loss         = VALUES(date_of_loss),
         loss_type            = VALUES(loss_type),
         client_email         = VALUES(client_email),
         attorney_email       = VALUES(attorney_email),
         paralegal_email      = VALUES(paralegal_email),
         status               = VALUES(status),
         updated_at           = NOW()
      `,
      [
        caseId,
        uid,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        client_email,
        attorney_email,
        paralegal_email
      ]
    );

    return res.json({ success: true, message: 'LOR to IC data saved' });
  } catch (err) {
    console.error('❌  LOR to IC data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update LOR to IC status
router.put('/lor_to_ic', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to IC status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to IC status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to IC status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/lor_to_ic/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to IC status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to IC status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to IC status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete LOR to IC entries
router.delete('/lor_to_ic', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to IC entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to IC entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/lor_to_ic/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to IC entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to IC entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger LOR to IC via n8n
router.post('/lor_to_ic/trigger', async (req, res) => {
  // --- Caller audit for LOR to IC trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 LOR to IC /lor_to_ic/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log LOR to IC trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-ic';
  console.log('▶️  Triggering LOR to IC webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  LOR to IC automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  LOR to IC trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger LOR to IC automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  LOR to IC trigger error:', errorData || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger LOR to IC automation', details: err.message });
  }
});

// Re-run LOR to IC: clear existing and trigger again via n8n
router.post('/lor_to_ic/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing LOR to IC entries for this case
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing LOR to IC entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-ic';
    if (!n8nUrl) {
      console.error('❌  LOR to IC webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering LOR to IC webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run LOR to IC automation triggered:', response.status);

    return res.json({ success: true, message: 'LOR to IC re-run triggered' });
  } catch (err) {
    console.error('❌  LOR to IC re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit LOR to IC to UiPath via n8n webhook
router.post('/lor_to_ic/queue', async (req, res) => {
  const {
    caseId,
    uid,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    loss_type,
    client_email,
    attorney_email,
    paralegal_email
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 LOR to IC status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing LOR to IC:', e.message);
  }

  // Use hardcoded n8n webhook URL for UiPath submission
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-ic-uipath';
  console.log('▶️  Submitting LOR to IC to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const payload = {
      caseId,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      loss_type,
      client_email,
      attorney_email,
      paralegal_email,
      uid
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ LOR to IC UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ LOR to IC UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit LOR to IC to UiPath', details: err.message });
  }
});
// ==============================
// CRN Filing (file_crn) CRUD & triggers
// ==============================

// Fetch CRN data
router.get('/crn', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch CRN called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch CRN called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         complainant_first_name,
         complainant_last_name,
         complainant_street_address,
         complainant_city,
         complainant_state,
         complainant_zip,
         complainant_email,
         complainant_type,
         insured_last_name,
         insured_first_name,
         insured_policy,
         insured_claim,
         attorneys_last_name,
         attorneys_first_name,
         attorneys_street_address,
         attorneys_city,
         attorneys_state,
         attorneys_zip,
         attorneys_email,
        insurance_email,
        insurance_address,
         violation_insurer_name,
         violation_individual_reponsible,
         violation_type_of_insurance,
         violation_reason_notice,
         violation_statutory_provisions,
         date_of_loss,
         facts,
         policy_language,
         policy_language_facts,
         status,
         created_at,
         updated_at
       FROM file_crn
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 CRN query returned rows:', rows);

    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected CRN record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch CRN data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert CRN data
router.post('/crn', async (req, res) => {
  console.log('📥 POST /automations/crn body:', req.body);
  const caseId = req.body.caseId ?? req.body.case_id;
  const complainant_first_name      = req.body.complainant_first_name      ?? null;
  const complainant_last_name       = req.body.complainant_last_name       ?? null;
  const complainant_street_address  = req.body.complainant_street_address  ?? null;
  const complainant_city            = req.body.complainant_city            ?? null;
  const complainant_state           = req.body.complainant_state           ?? null;
  const complainant_zip             = req.body.complainant_zip             ?? null;
  const complainant_email           = req.body.complainant_email           ?? null;
  const complainant_type            = req.body.complainant_type            ?? null;
  const insured_last_name           = req.body.insured_last_name           ?? null;
  const insured_first_name          = req.body.insured_first_name          ?? null;
  const insured_policy              = req.body.insured_policy              ?? null;
  const insured_claim               = req.body.insured_claim               ?? null;
  const attorneys_last_name         = req.body.attorneys_last_name         ?? null;
  const attorneys_first_name        = req.body.attorneys_first_name        ?? null;
  const attorneys_street_address    = req.body.attorneys_street_address    ?? null;
  const attorneys_city              = req.body.attorneys_city              ?? null;
  const attorneys_state             = req.body.attorneys_state             ?? null;
  const attorneys_zip               = req.body.attorneys_zip               ?? null;
  const attorneys_email             = req.body.attorneys_email             ?? null;
  const violation_insurer_name      = req.body.violation_insurer_name      ?? null;
  const violation_individual_reponsible = req.body.violation_individual_reponsible ?? null;
  const violation_type_of_insurance = req.body.violation_type_of_insurance ?? null;
  const violation_reason_notice     = req.body.violation_reason_notice     ?? null;
  const violation_statutory_provisions = req.body.violation_statutory_provisions ?? null;
  const facts                       = req.body.facts ?? null;
  const policy_language = req.body.policy_language ?? null;
  const policy_language_facts = req.body.policy_language_facts ?? null;
  const insurance_email = req.body.insurance_email ?? null;
  const insurance_address = req.body.insurance_address ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO file_crn (
         case_id,
         complainant_first_name,
         complainant_last_name,
         complainant_street_address,
         complainant_city,
         complainant_state,
         complainant_zip,
         complainant_email,
         complainant_type,
         insured_last_name,
         insured_first_name,
         insured_policy,
         insured_claim,
      insurance_email,
      insurance_address,
         attorneys_last_name,
         attorneys_first_name,
         attorneys_street_address,
         attorneys_city,
         attorneys_state,
         attorneys_zip,
         attorneys_email,
         violation_insurer_name,
         violation_individual_reponsible,
         violation_type_of_insurance,
         violation_reason_notice,
         violation_statutory_provisions,
         date_of_loss,
         facts,
         policy_language,
         policy_language_facts,
         status,
         created_at,
         updated_at
       ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         complainant_first_name      = VALUES(complainant_first_name),
         complainant_last_name       = VALUES(complainant_last_name),
         complainant_street_address  = VALUES(complainant_street_address),
         complainant_city            = VALUES(complainant_city),
         complainant_state           = VALUES(complainant_state),
         complainant_zip             = VALUES(complainant_zip),
         complainant_email           = VALUES(complainant_email),
         complainant_type            = VALUES(complainant_type),
         insured_last_name           = VALUES(insured_last_name),
         insured_first_name          = VALUES(insured_first_name),
         insured_policy              = VALUES(insured_policy),
         insured_claim               = VALUES(insured_claim),
         attorneys_last_name         = VALUES(attorneys_last_name),
         attorneys_first_name        = VALUES(attorneys_first_name),
         attorneys_street_address    = VALUES(attorneys_street_address),
         attorneys_city              = VALUES(attorneys_city),
         attorneys_state             = VALUES(attorneys_state),
         attorneys_zip               = VALUES(attorneys_zip),
         attorneys_email             = VALUES(attorneys_email),
         violation_insurer_name      = VALUES(violation_insurer_name),
         violation_individual_reponsible = VALUES(violation_individual_reponsible),
         insurance_email = VALUES(insurance_email),
         insurance_address = VALUES(insurance_address),
         violation_type_of_insurance = VALUES(violation_type_of_insurance),
         date_of_loss = VALUES(date_of_loss),
         violation_reason_notice     = VALUES(violation_reason_notice),
         violation_statutory_provisions = VALUES(violation_statutory_provisions),
         facts                       = VALUES(facts),
         policy_language             = VALUES(policy_language),
          policy_language_facts       = VALUES(policy_language_facts),
         status              = VALUES(status),
         updated_at          = NOW()
      `,
      [
        caseId,
        complainant_first_name,
        complainant_last_name,
        complainant_street_address,
        complainant_city,
        complainant_state,
        complainant_zip,
        complainant_email,
        complainant_type,
        insured_last_name,
        insured_first_name,
        insured_policy,
        insured_claim,
        insurance_email,
        insurance_address,
        attorneys_last_name,
        attorneys_first_name,
        attorneys_street_address,
        attorneys_city,
        attorneys_state,
        attorneys_zip,
        attorneys_email,
        violation_insurer_name,
        violation_individual_reponsible,
        violation_type_of_insurance,
        violation_reason_notice,
        violation_statutory_provisions,
        date_of_loss,
        facts,
        policy_language,
        policy_language_facts,

        'pending'
      ]
    );

    return res.json({ success: true, message: 'CRN data saved' });
  } catch (err) {
    console.error('❌  CRN data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update CRN status
router.put('/crn', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE file_crn SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated CRN status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'CRN status updated', status });
  } catch (err) {
    console.error('❌  Update CRN status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/crn/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE file_crn SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated CRN status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'CRN status updated', status });
  } catch (err) {
    console.error('❌  Update CRN status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete CRN entries (query param)
router.delete('/crn', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM file_crn WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'CRN entries deleted' });
  } catch (err) {
    console.error('❌  Delete CRN entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete CRN entries (path param)
router.delete('/crn/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM file_crn WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'CRN entries deleted' });
  } catch (err) {
    console.error('❌  Delete CRN entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger CRN via n8n (ONLY sends caseId + selected documents from frontend)
// Trigger CRN via n8n (ONLY sends caseId + full document URLs to n8n)
// const triggerCrnHandler = async (req, res) => {
//   const caseId =
//     req.body.caseId ??
//     req.body.case_id ??
//     req.query.caseId ??
//     req.query.case_id ??
//     null;

//   const uid = req.body.uid ?? req.headers['x-user-uid'] ?? null;

//   // Frontend sends full document objects (from /cases/:id/documents)
//   const documents = Array.isArray(req.body.documents)
//     ? req.body.documents
//     : [];

//   if (!caseId) {
//     return res
//       .status(400)
//       .json({ success: false, message: 'Missing caseId' });
//   }

//   const n8nUrl = process.env.N8N_FILE_CRN_WEBHOOK_URL;
//   if (!n8nUrl) {
//     console.error('❌  N8N_FILE_CRN_WEBHOOK_URL is not set in .env');
//     return res
//       .status(500)
//       .json({ success: false, message: 'N8N webhook URL not configured' });
//   }

//   // 🔧 Base URL for public document links
//   // 👉 set this in .env (for dev/prod) e.g. DOCUMENT_BASE_URL=https://dev.louislawgroup.com
//   const baseUrl =
//     process.env.DOCUMENT_BASE_URL || 'https://dev.louislawgroup.com';

//   const cleanSegment = (s) =>
//     encodeURIComponent(String(s || '').replace(/^\/+|\/+$/g, ''));

//   // 🔹 Build full URLs like:
//   // https://dev.louislawgroup.com/cases/{caseId}/documents/{folder}/{fileName}
//   const document_urls = documents
//     .map((doc) => {
//       const fileName =
//         doc.fileName ||
//         doc.name ||
//         doc.document_name ||
//         null;

//       if (!fileName) return null;

//       const folder = doc.folder || ''; // may be empty string
//       const folderPart = folder
//         ? `${cleanSegment(folder)}/`
//         : '';

//       return `${baseUrl}/cases/${cleanSegment(
//         caseId
//       )}/documents/${folderPart}${cleanSegment(fileName)}`;
//     })
//     .filter(Boolean);

//   const payload = {
//     caseId,
//     uid: uid || null,
//     document_urls, // ⬅️ ONLY the full URLs n8n cares about
//   };

//   console.log('▶️  CRN webhook payload (to n8n):', JSON.stringify(payload, null, 2));

//   try {
//     const response = await axios.post(n8nUrl, payload);
//     console.log('✅  CRN automation triggered:', response.status);
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error(
//       '❌  CRN trigger error:',
//       err.response?.data || err.message
//     );
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to trigger CRN automation',
//       details: err.message,
//     });
//   }
// };
const triggerCrnHandler = async (req, res) => {
  const caseId =
    req.body.caseId ??
    req.body.case_id ??
    req.query.caseId ??
    req.query.case_id ??
    null;

  const uid = req.body.uid ?? req.headers['x-user-uid'] ?? null;

  // Frontend sends full document objects (from /cases/:id/documents)
  const documents = Array.isArray(req.body.documents)
    ? req.body.documents
    : [];

  if (!caseId) {
    return res
      .status(400)
      .json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = process.env.N8N_FILE_CRN_WEBHOOK_URL;
  if (!n8nUrl) {
    console.error('❌  N8N_FILE_CRN_WEBHOOK_URL is not set in .env');
    return res
      .status(500)
      .json({ success: false, message: 'N8N webhook URL not configured' });
  }

  // 🔧 Base URL for public document links
  // 👉 set this in .env (for dev/prod) e.g. DOCUMENT_BASE_URL=https://dev.louislawgroup.com
  const baseUrl =
    process.env.DOCUMENT_BASE_URL || 'https://dev.louislawgroup.com';

  const cleanSegment = (s) =>
    encodeURIComponent(String(s || '').replace(/^\/+|\/+$/g, ''));

  // 🔹 Build full URLs like:
  // https://dev.louislawgroup.com/cases/{caseId}/documents/{folder}/{fileName}
  const document_urls = documents
    .map((doc) => {
      const fileName =
        doc.fileName ||
        doc.name ||
        doc.document_name ||
        null;

      if (!fileName) return null;

      const folder = doc.folder || ''; // may be empty string
      const folderPart = folder
        ? `${cleanSegment(folder)}/`
        : '';

      return `${baseUrl}/cases/${cleanSegment(
        caseId
      )}/documents/${folderPart}${cleanSegment(fileName)}`;
    })
    .filter(Boolean);

  const payload = {
    caseId,
    uid: uid || null,
    document_urls, // ⬅️ ONLY the full URLs n8n cares about
  };

  console.log('▶️  CRN webhook payload (to n8n):', JSON.stringify(payload, null, 2));

  try {
    // 🔹 Set status to 'loading' in database before triggering n8n
 try {
      console.log('🔹 Attempting to set CRN status to loading for caseId:', caseId, 'firsttrigger_uid:', uid);
      await db.promisePool.execute(
        'INSERT INTO file_crn (case_id, status, firsttrigger_uid, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE status = ?, firsttrigger_uid = ?, updated_at = NOW()',
        [caseId, 'loading', uid ?? null, 'loading', uid ?? null]
      );
      console.log('✅ CRN status successfully set to loading for caseId', caseId);
    } catch (e) {
  console.error('❌❌❌ FAILED to set loading status before triggering CRN!');
  console.error('❌ Error message:', e.message);
  console.error('❌ Error code:', e.code);
  console.error('❌ Full error:', e);
}

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  CRN automation triggered:', response.status);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error(
      '❌  CRN trigger error:',
      err.response?.data || err.message
    );
    
    // 🔹 Update status to 'failed' on error
    try {
      await db.promisePool.execute(
        'UPDATE file_crn SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
      console.log('💾 CRN status set to failed for caseId', caseId, 'due to error');
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger CRN automation',
      details: err.message,
    });
  }
};
router.post('/crn/trigger', triggerCrnHandler);
router.post('/file_crn', triggerCrnHandler);

// Re-run CRN: clear existing and trigger again via n8n
router.post('/crn/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute('DELETE FROM file_crn WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing CRN entries for caseId', caseId);

    const n8nUrl = process.env.N8N_FILE_CRN_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('❌  N8N_FILE_CRN_WEBHOOK_URL is not set in .env');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }
    console.log('▶️  Re-triggering CRN webhook:', n8nUrl, 'with caseId:', caseId);
    await axios.post(n8nUrl, { caseId });

    return res.json({ success: true, message: 'CRN re-run triggered' });
  } catch (err) {
    console.error('❌  CRN re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Enqueue CRN in UiPath Orchestrator
router.post('/crn/queue', async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const uid = req.body.uid ?? req.headers['x-user-uid'] ?? null;
  const complainant_first_name      = req.body.complainant_first_name      ?? null;
  const complainant_last_name       = req.body.complainant_last_name       ?? null;
  const complainant_street_address  = req.body.complainant_street_address  ?? null;
  const complainant_city            = req.body.complainant_city            ?? null;
  const complainant_state           = req.body.complainant_state           ?? null;
  const complainant_zip             = req.body.complainant_zip             ?? null;
  const complainant_email           = req.body.complainant_email           ?? null;
  const complainant_type            = req.body.complainant_type            ?? null;
  const insured_last_name           = req.body.insured_last_name           ?? null;
  const insured_first_name          = req.body.insured_first_name          ?? null;
  const insured_policy              = req.body.insured_policy              ?? null;
  const insured_claim               = req.body.insured_claim               ?? null;
  const attorneys_last_name         = req.body.attorneys_last_name         ?? null;
  const attorneys_first_name        = req.body.attorneys_first_name        ?? null;
  const attorneys_street_address    = req.body.attorneys_street_address    ?? null;
  const attorneys_city              = req.body.attorneys_city              ?? null;
  const attorneys_state             = req.body.attorneys_state             ?? null;
  const attorneys_zip               = req.body.attorneys_zip               ?? null;
  const attorneys_email             = req.body.attorneys_email             ?? null;
  const violation_insurer_name      = req.body.violation_insurer_name      ?? null;
  const violation_individual_reponsible = req.body.violation_individual_reponsible ?? null;
  const violation_type_of_insurance = req.body.violation_type_of_insurance ?? null;
  const violation_reason_notice     = req.body.violation_reason_notice     ?? null;
  const violation_statutory_provisions = req.body.violation_statutory_provisions ?? null;
 const facts = req.body.facts_text ?? req.body.facts ?? null;
  const policy_language             = req.body.policy_language ?? null;
  const policy_language_facts       = req.body.policy_language_facts ?? null;
  const generated_narrative         = req.body.generated_narrative ?? null;
  const coverage_determination      = req.body.coverage_determination ?? null;
  const date_of_loss                = req.body.date_of_loss ?? null;
  const insurance_email             = req.body.insurance_email ?? null;
  const insurance_address           = req.body.insurance_address ?? null;

  // ensure large or complex text fields are strings
  const safeGeneratedNarrative = generated_narrative === null ? null : String(generated_narrative).trim();
  const safeFacts = facts === null ? null : String(facts).trim();
  const safeDateOfLoss = date_of_loss === null ? null : String(date_of_loss).trim();

  const normalize = (value) => {
    if (value === null || value === undefined) return null;
    const str = value.toString().trim();
    return str.length ? str : null;
  };

  const sanitizeEnv = (value) => {
    if (value === undefined || value === null) return null;
    const str = value.toString().trim();
    if (!str.length) return null;
    return str.replace(/^['"]|['"]$/g, '');
  };

  const buildFullName = (first, last) => {
    const parts = [normalize(first), normalize(last)].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  };

  const fallbackAddressParts = [complainant_street_address, complainant_city, complainant_state, complainant_zip]
    .map((part) => normalize(part))
    .filter(Boolean);
  const fallbackAddress = fallbackAddressParts.length ? fallbackAddressParts.join(', ') : null;

  const legacyClaimantName = normalize(req.body.claimant_name) ?? buildFullName(complainant_first_name, complainant_last_name);
  const legacyDefendant = normalize(req.body.defendant) ?? normalize(violation_insurer_name);
  const legacyPolicyNumber = normalize(req.body.policy_number) ?? normalize(insured_policy);
  const legacyClaimNumber = normalize(req.body.claim_number) ?? normalize(insured_claim);
  const legacyEmail = normalize(req.body.email) ?? normalize(complainant_email);
  const legacyAddress = normalize(req.body.address) ?? fallbackAddress;
  const legacyCity = normalize(req.body.city) ?? normalize(complainant_city);
  const legacyState = normalize(req.body.state) ?? normalize(complainant_state);
  const legacyZipCode = normalize(req.body.zip_code) ?? normalize(complainant_zip);
  const legacyAttorneyFirstName = normalize(req.body.attorney_first_name) ?? normalize(attorneys_first_name);
  const legacyAttorneyLastName = normalize(req.body.attorney_last_name) ?? normalize(attorneys_last_name);

  const orchestratorUrl = sanitizeEnv(process.env.UIPATH_ORCH_CRN_URL) ?? sanitizeEnv(process.env.UIPATH_ORCH_URL);
  const folderId = sanitizeEnv(process.env.UIPATH_CRN_FOLDER_ID) ?? sanitizeEnv(process.env.UIPATH_FOLDER_ID);
  const queueName = sanitizeEnv(process.env.UIPATH_CRN_QUEUE_NAME) ?? 'CRN_Queue';
  const tokenClientId = sanitizeEnv(process.env.UIPATH_CRN_CLIENT_ID) ?? sanitizeEnv(process.env.UIPATH_CLIENT_ID);
  const tokenClientSecret = sanitizeEnv(process.env.UIPATH_CRN_CLIENT_SECRET) ?? sanitizeEnv(process.env.UIPATH_CLIENT_SECRET);

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  if (!tokenClientId || !tokenClientSecret) {
    console.error('❌  UiPath credentials not configured for CRN queue');
    return res.status(500).json({ success: false, message: 'UiPath credentials not configured for CRN queue' });
  }

  if (!orchestratorUrl || !queueName || !folderId) {
    console.error('❌  UiPath orchestrator URL, queue name, or folder ID missing for CRN queue');
    return res.status(500).json({ success: false, message: 'UiPath CRN queue configuration incomplete' });
  }

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE file_crn SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 CRN status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing CRN:', e.message);
  }

  try {
    console.log('▶️  Requesting UiPath token for CRN queue');
    const resp = await axios.post(
      process.env.UIPATH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: tokenClientId,
        client_secret: tokenClientSecret,
        scope: process.env.UIPATH_TOKEN_SCOPE,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = resp.data.access_token;

    console.log('🔧 CRN Orchestrator Config:', {
      orchUrl: orchestratorUrl,
      folderId,
      queueName,
    });

    const itemData = {
      Name: queueName,
      Priority: 'High',
      SpecificContent: (function() {
        const simpleValue = (v) => {
          if (v === null || v === undefined) return null;
          if (v instanceof Date) return v.toISOString();
          const t = typeof v;
          if (t === 'string' || t === 'number' || t === 'boolean') return v;
          try {
            return JSON.stringify(v);
          } catch (e) {
            return String(v);
          }
        };

        return {
          caseId: simpleValue(caseId),
          uid: simpleValue(uid),
          complainant_first_name: simpleValue(complainant_first_name),
          complainant_last_name: simpleValue(complainant_last_name),
          complainant_street_address: simpleValue(complainant_street_address),
          complainant_city: simpleValue(complainant_city),
          complainant_state: simpleValue(complainant_state),
          complainant_zip: simpleValue(complainant_zip),
          complainant_email: simpleValue(complainant_email),
          complainant_type: simpleValue(complainant_type),
          insured_last_name: simpleValue(insured_last_name),
          insured_first_name: simpleValue(insured_first_name),
          insured_policy: simpleValue(insured_policy),
          insured_claim: simpleValue(insured_claim),
          attorneys_last_name: simpleValue(attorneys_last_name),
          attorneys_first_name: simpleValue(attorneys_first_name),
          attorneys_street_address: simpleValue(attorneys_street_address),
          attorneys_city: simpleValue(attorneys_city),
          attorneys_state: simpleValue(attorneys_state),
          attorneys_zip: simpleValue(attorneys_zip),
          attorneys_email: simpleValue(attorneys_email),
          violation_insurer_name: simpleValue(violation_insurer_name),
          violation_individual_reponsible: simpleValue(violation_individual_reponsible),
          violation_type_of_insurance: simpleValue(violation_type_of_insurance),
          violation_reason_notice: simpleValue(violation_reason_notice),
          violation_statutory_provisions: simpleValue(violation_statutory_provisions),
          facts: simpleValue(safeFacts),
          insurance_email: simpleValue(insurance_email),
          insurance_address: simpleValue(insurance_address),
          policy_language: simpleValue(policy_language),
          policy_language_facts: simpleValue(policy_language_facts),
          generated_narrative: simpleValue(safeGeneratedNarrative),
          coverage_determination: simpleValue(coverage_determination),
          date_of_loss: simpleValue(safeDateOfLoss),
          claimant_name: simpleValue(legacyClaimantName),
          defendant: simpleValue(legacyDefendant),
          policy_number: simpleValue(legacyPolicyNumber),
          claim_number: simpleValue(legacyClaimNumber),
          email: simpleValue(legacyEmail),
          address: simpleValue(legacyAddress),
          city: simpleValue(legacyCity),
          state: simpleValue(legacyState),
          zip_code: simpleValue(legacyZipCode),
          attorney_first_name: simpleValue(legacyAttorneyFirstName),
          attorney_last_name: simpleValue(legacyAttorneyLastName)
        };
      })(),
      DeferDate: new Date().toISOString(),
    };

    const queueResp = await axios.post(
      `${orchestratorUrl}/odata/Queues/UiPathODataSvc.AddQueueItem`,
      { itemData },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-UIPATH-OrganizationUnitId': folderId,
          'X-UIPATH-TenantName': process.env.UIPATH_TENANT,
        },
      }
    );

    console.log('✅ CRN AddQueueItem response:', queueResp.data);
    return res.json({ success: true, data: queueResp.data });
  } catch (err) {
    console.error('❌ CRN AddQueueItem error for caseId', caseId, ':', err.response?.data || err.message);
    if (err.response && err.response.headers) {
      console.error('🔍 Response status:', err.response.status);
      console.error('🔍 Response headers:', err.response.headers);
      console.error('🔍 www-authenticate header:', err.response.headers['www-authenticate']);
      console.error('🔍 x-uipath-correlation-id:', err.response.headers['x-uipath-correlation-id']);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});












router.post('/file_suit_breach_of_contract', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_FILE_SUIT_BREACH_OF_CONTRACT_WEBHOOK_URL;
  console.log('▶️  Triggering File Suit (Breach of Contract) webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  File Suit (Breach of Contract) response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  File Suit (Breach of Contract) error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger File Suit (Breach of Contract) automation' });
  }
});

router.post('/file_suit_declaratory_action', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  const n8nUrl = process.env.N8N_FILE_SUIT_DECLARATORY_ACTION_WEBHOOK_URL;
  console.log('▶️  Triggering File Suit (Declaratory Action) webhook:', n8nUrl, 'with caseId:', caseId);
  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  File Suit (Declaratory Action) response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  File Suit (Declaratory Action) error:', { message: err.message, status: err.response?.status, data: err.response?.data });
    return res.status(500).json({ success: false, message: 'Failed to trigger File Suit (Declaratory Action) automation' });
  }
});







/**
 * POST /automations/noi/queue
 * Enqueue a new NOI work item in UiPath Orchestrator Queue
 */
router.post('/noi/queue', async (req, res) => {
  const {
    caseId,
    claimant_name,
    defendant,
    policy_number,
    claim_number,
    pa_estimate,
    aob_dtp_invoice_amount,
    email,
    address,
    city,
    state,
    zip_code,
    attorney_first_name,
    attorney_last_name,
    generated_narrative,
    coverage_determination,
    date_of_loss
  } = req.body;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Persist status transition to 'loading' as soon as job is queued
  try {
    await db.promisePool.execute('UPDATE noi_auto SET status = ? WHERE case_id = ?', ['loading', caseId]);
    console.log('💾 Status set to loading for caseId', caseId);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing:', e.message);
  }

  try {
    // ▶️  Requesting UiPath access token via client credentials
    console.log('▶️  Requesting UiPath access token via client credentials');
    // console.log('🔧 UiPath Token Config:', {
    //   tokenUrl: process.env.UIPATH_TOKEN_URL,
    //   clientId: process.env.UIPATH_CLIENT_ID,
    //   secretLength: process.env.UIPATH_CLIENT_SECRET?.length,
    //   tenant: process.env.UIPATH_TENANT,
    // });
    // ▶️  Requesting UiPath access token via client credentials
    console.log('▶️  Requesting UiPath access token via client credentials');
    const resp = await axios.post(
      process.env.UIPATH_TOKEN_URL,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     process.env.UIPATH_CLIENT_ID,
        client_secret: process.env.UIPATH_CLIENT_SECRET,
        scope:         process.env.UIPATH_TOKEN_SCOPE,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    console.log('🎟️  Token response data:', resp.data);
    const token = resp.data.access_token;
    console.log('✅  Obtained access token');

    // Log orchestrator endpoint and queue details
    console.log('🔧 Orchestrator Config:', {
      orchUrl: process.env.UIPATH_ORCH_URL,
      folderId: process.env.UIPATH_FOLDER_ID,
      queueName: process.env.UIPATH_NOI_QUEUE_NAME,
    });
    // Log AddQueueItem payload context
    console.log('▶️  Preparing AddQueueItem with payload:', { caseId, claimant_name, defendant, policy_number, claim_number, pa_estimate, email, address, city, state, zip_code, attorney_first_name, attorney_last_name, generated_narrative });

    // Build the queue item payload
    const itemData = {
      Name: process.env.UIPATH_NOI_QUEUE_NAME,
      Priority: 'High',
      SpecificContent: {
        caseId,
        claimant_name,
        defendant,
        policy_number,
        claim_number,
        pa_estimate,
        aob_dtp_invoice_amount,
        email,
        address,
        city,
        state,
        zip_code,
        attorney_first_name,
        attorney_last_name,
        generated_narrative,
        coverage_determination,
        date_of_loss
      },
      DeferDate: new Date().toISOString()
    };

    // Call AddQueueItem endpoint
    const queueResp = await axios.post(
      `${process.env.UIPATH_ORCH_URL}/odata/Queues/UiPathODataSvc.AddQueueItem`,
      { itemData },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-UIPATH-OrganizationUnitId': process.env.UIPATH_FOLDER_ID,
          'X-UIPATH-TenantName': process.env.UIPATH_TENANT
        }
      }
    );

    console.log('✅ AddQueueItem response:', queueResp.data);
    return res.json({ success: true, data: queueResp.data });
  } catch (err) {
    console.error('❌ AddQueueItem error for caseId', caseId, ':', err.response?.data || err.message);
    if (err.response && err.response.headers) {
      console.error('🔍 Response status:', err.response.status);
      console.error('🔍 Response headers:', err.response.headers);
      console.error('🔍 www-authenticate header:', err.response.headers['www-authenticate']);
      console.error('🔍 x-uipath-correlation-id:', err.response.headers['x-uipath-correlation-id']);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// Turn Down Letter (turndown_letter) CRUD & UiPath queue
// ==============================

// Fetch Turn Down Letter data
router.get('/turndown_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch TurnDown called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch TurnDown called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         plaintiff,
         client_email,
         client_address,
         claim_number,
         policy_number,
         date_of_loss,
         loss_type,
         attorneys_email,
         paralegals_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM turndown_letter
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 TurnDown query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected TurnDown record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch TurnDown data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Turn Down Letter data
router.post('/turndown_letter', async (req, res) => {
  console.log('📥 POST /automations/turndown_letter body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 TurnDown upsert uid:', uid);

  const caseId           = req.body.caseId ?? req.body.case_id;
  const plaintiff        = req.body.plaintiff ?? req.body.plaintiff_name ?? null;
  const client_email     = req.body.client_email ?? null;
  const client_address   = req.body.client_address ?? null;
  const claim_number     = req.body.claim_number ?? null;
  const policy_number    = req.body.policy_number ?? null;
  const date_of_loss     = req.body.date_of_loss ?? null; // free-text string
  const loss_type        = req.body.loss_type ?? null;
  const attorneys_email  = req.body.attorneys_email ?? req.body.attorney_email ?? null;
  const paralegals_email = req.body.paralegals_email ?? req.body.paralegal_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO turndown_letter (
         case_id,
         uid,
         plaintiff,
         client_email,
         client_address,
         claim_number,
         policy_number,
         date_of_loss,
         loss_type,
         attorneys_email,
         paralegals_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid              = VALUES(uid),
         plaintiff        = VALUES(plaintiff),
         client_email     = VALUES(client_email),
         client_address   = VALUES(client_address),
         claim_number     = VALUES(claim_number),
         policy_number    = VALUES(policy_number),
         date_of_loss     = VALUES(date_of_loss),
         loss_type        = VALUES(loss_type),
         attorneys_email  = VALUES(attorneys_email),
         paralegals_email = VALUES(paralegals_email),
         status           = VALUES(status),
         updated_at       = NOW()
      `,
      [
        caseId,
        uid,
        plaintiff,
        client_email,
        client_address,
        claim_number,
        policy_number,
        date_of_loss,
        loss_type,
        attorneys_email,
        paralegals_email,
        'pending'
      ]
    );

    return res.json({ success: true, message: 'Turn Down Letter data saved' });
  } catch (err) {
    console.error('❌  TurnDown data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Turn Down Letter status
router.put('/turndown_letter', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE turndown_letter SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated TurnDown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Turn Down Letter status updated', status });
  } catch (err) {
    console.error('❌  Update TurnDown status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/turndown_letter/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE turndown_letter SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated TurnDown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Turn Down Letter status updated', status });
  } catch (err) {
    console.error('❌  Update TurnDown status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Turn Down Letter entries
router.delete('/turndown_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM turndown_letter WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Turn Down Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete TurnDown entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/turndown_letter/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM turndown_letter WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Turn Down Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete TurnDown entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Turn Down Letter via n8n
router.post('/turndown_letter/trigger', async (req, res) => {
  // --- Caller audit for Turn Down trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 TurnDown /turndown_letter/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log TurnDown trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = process.env.N8N_TURN_DOWN_LETTER_WEBHOOK_URL;
  if (!n8nUrl) {
    console.error('❌  N8N_TURN_DOWN_LETTER_WEBHOOK_URL is not set in .env');
    return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
  }
  console.log('▶️  Triggering Turn Down Letter webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Turn Down Letter automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Turn Down Letter trigger error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Turn Down Letter automation', details: err.message });
  }
});

// Re-run Turn Down Letter: clear existing and trigger again via n8n
router.post('/turndown_letter/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing Turn Down Letter entries for this case
    await db.promisePool.execute('DELETE FROM turndown_letter WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Turn Down Letter entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = process.env.N8N_TURN_DOWN_LETTER_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('❌  N8N_TURN_DOWN_LETTER_WEBHOOK_URL is not set in .env');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering Turn Down Letter webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Turn Down Letter automation triggered:', response.status);

    return res.json({ success: true, message: 'Turn Down Letter re-run triggered' });
  } catch (err) {
    console.error('❌  Turn Down Letter re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Enqueue Turn Down Letter in UiPath Orchestrator
router.post('/turndown_letter/queue', async (req, res) => {
  const {
    caseId,
    uid,
    plaintiff,
    client_email,
    client_address,
    claim_number,
    policy_number,
    date_of_loss,
    loss_type,
    attorneys_email,
    paralegals_email
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE turndown_letter SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 TurnDown status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing TurnDown:', e.message);
  }

  try {
    console.log('▶️  Requesting UiPath token for TurnDown queue');
    const resp = await axios.post(
      process.env.UIPATH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.UIPATH_TURN_DOWN_LETTER_CLIENT_ID,
        client_secret: process.env.UIPATH_TURN_DOWN_LETTER_CLIENT_SECRET,
        scope: process.env.UIPATH_TOKEN_SCOPE,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = resp.data.access_token;

    console.log('🔧 TurnDown Orchestrator Config:', {
      orchUrl: process.env.UIPATH_ORCH_TURN_DOWN_LETTER_URL,
      folderId: process.env.UIPATH_TURN_DOWN_LETTER_FOLDER_ID,
      queueName: process.env.UIPATH_TURN_DOWN_LETTER_QUEUE_NAME,
    });

    const itemData = {
      Name: process.env.UIPATH_TURN_DOWN_LETTER_QUEUE_NAME,
      Priority: 'High',
      SpecificContent: {
        caseId,
        plaintiff,
        client_email,
        client_address,
        claim_number,
        policy_number,
        date_of_loss,
        loss_type,
        attorneys_email,
        paralegals_email
      },
      DeferDate: new Date().toISOString(),
    };

    const queueResp = await axios.post(
      `${process.env.UIPATH_ORCH_TURN_DOWN_LETTER_URL}/odata/Queues/UiPathODataSvc.AddQueueItem`,
      { itemData },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-UIPATH-OrganizationUnitId': process.env.UIPATH_TURN_DOWN_LETTER_FOLDER_ID,
          'X-UIPATH-TenantName': process.env.UIPATH_TENANT,
        },
      }
    );

    console.log('✅ TurnDown AddQueueItem response:', queueResp.data);
    return res.json({ success: true, data: queueResp.data });
  } catch (err) {
    console.error('❌ TurnDown AddQueueItem error for caseId', caseId, ':', err.response?.data || err.message);
    if (err.response && err.response.headers) {
      console.error('🔍 Response status:', err.response.status);
      console.error('🔍 Response headers:', err.response.headers);
      console.error('🔍 www-authenticate header:', err.response.headers['www-authenticate']);
      console.error('🔍 x-uipath-correlation-id:', err.response.headers['x-uipath-correlation-id']);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});











// Trigger Lawsuit (file suit) via n8n
router.post('/lawsuits', async (req, res) => {
  const { caseId } = req.body || {};
  const n8nUrl = process.env.N8N_LAWSUITS_WEBHOOK_URL;

  if (!n8nUrl) {
    console.error('❌  N8N_LAWSUITS_WEBHOOK_URL is not set in .env');
    return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
  }

  // Optional: basic sanity check for JSON body
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ success: false, message: 'Body must be a JSON object' });
  }

  console.log('▶️  Triggering Lawsuits webhook:', n8nUrl, 'caseId:', caseId, 'keys:', Object.keys(req.body));

  try {
    const response = await axios.post(n8nUrl, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });

    console.log('✅  Lawsuits webhook response:', response.status);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Lawsuits trigger error:', err.response?.data || err.message);
    return res
      .status(err.response?.status || 500)
      .json({ success: false, message: 'Failed to trigger lawsuits webhook', details: err.message });
  }
});


// Trigger UiPath (send selected documents) via n8n
router.post('/ui-path-trigger', async (req, res) => {
  const n8nUrl =
    process.env.N8N_UIPATH_WEBHOOK_URL ||
    'https://n8n.louislawgroup.com/webhook/ui-path-trigger';

  if (!n8nUrl) {
    console.error('❌  N8N_UIPATH_WEBHOOK_URL is not set in .env');
    return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
  }

  // Expect: { caseId, case_name?, case_number?, documents: [{ name, folder, url }] }
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ success: false, message: 'Body must be a JSON object' });
  }
  const { caseId, documents } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'caseId is required' });
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ success: false, message: 'documents array is required' });
  }

  console.log('▶️  Triggering UiPath webhook:', n8nUrl, 'caseId:', caseId, 'docs:', documents.length);

  try {
    const response = await axios.post(n8nUrl, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    console.log('✅  UiPath webhook response:', response.status);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const status = err.response?.status || 500;
    const details = err.response?.data || err.message;
    console.error('❌  UiPath trigger error:', details);
    return res
      .status(status)
      .json({ success: false, message: 'Failed to trigger UiPath webhook', details });
  }
});

// ───────────────────────────────────────────────
// Lawsuits Auto CRUD Routes
// ───────────────────────────────────────────────

// ───────────────────────────────────────────────
// Lawsuits Auto CRUD Routes (updated)
// ───────────────────────────────────────────────

const ALLOWED_STATUS = new Set(['pending', 'filed', 'completed', 'rejected']);

// helpers
const toNullIfEmpty = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
};

const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toYesNoOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(s)) return 'no';
  // if user already sends "yes"/"no" or any string, store it as-is (VARCHAR columns)
  return s;
};

// CREATE
// POST /automations/lawsuits-auto  → upsert by case_id (no duplicates)
router.post('/lawsuits-auto', async (req, res) => {
  try {
    const body = req.body || {};
    const case_id = String(body.case_id || body.caseId || '').trim();
    const case_name = body.case_name || '';
    const case_number = body.case_number || '';
    const attorney_email = body.attorney_email || '';
    const paralegal_email = body.paralegal_email || '';

    // New fields
    const type_of_lawsuit   = toNullIfEmpty(body.type_of_lawsuit);
    const claim_amount      = toNullIfEmpty(body.claim_amount);
    const court_type        = toNullIfEmpty(body.court_type);
    const county_civil      = toNullIfEmpty(body.county_civil);
    const remedies_sought   = toNullIfEmpty(body.remedies_sought);
    const number_of_actions = toIntOrNull(body.number_of_actions);
    const is_class_action   = toYesNoOrNull(body.is_class_action);
    const related_case      = toYesNoOrNull(body.related_case);
    const jury_trial_demanded = toYesNoOrNull(body.jury_trial_demanded);

    const statusRaw = (body.status || 'pending').toLowerCase();
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : 'pending';

    if (!case_id) {
      return res.status(400).json({ success: false, message: 'case_id is required' });
    }

    // 1) Is there already a row for this case_id?
    const [rows] = await db.promise().query(
      'SELECT id FROM lawsuits_auto WHERE case_id = ? LIMIT 1',
      [case_id]
    );

    if (rows && rows.length) {
      // 2) UPDATE existing row instead of inserting a duplicate
      const id = rows[0].id;
      const [result] = await db.promise().query(
        `UPDATE lawsuits_auto
           SET case_name = ?,
               case_number = ?,
               attorney_email = ?,
               paralegal_email = ?,
               status = ?,
               type_of_lawsuit = ?,
               claim_amount = ?,
               court_type = ?,
               county_civil = ?,
               remedies_sought = ?,
               number_of_actions = ?,
               is_class_action = ?,
               related_case = ?,
               jury_trial_demanded = ?,
               updated_at = NOW()
         WHERE id = ?`,
        [
          case_name,
          case_number,
          attorney_email,
          paralegal_email,
          status,
          type_of_lawsuit,
          claim_amount,
          court_type,
          county_civil,
          remedies_sought,
          number_of_actions,
          is_class_action,
          related_case,
          jury_trial_demanded,
          id
        ]
      );
      return res.json({ success: true, id, updated: result.affectedRows || 0, action: 'update' });
    }

    // 3) INSERT first row for this case_id
    const [insert] = await db.promise().query(
      `INSERT INTO lawsuits_auto
         (case_id, case_name, case_number, attorney_email, paralegal_email, status,
          type_of_lawsuit, claim_amount, court_type, county_civil, remedies_sought,
          number_of_actions, is_class_action, related_case, jury_trial_demanded,
          created_at, updated_at)
       VALUES (?,       ?,         ?,           ?,              ?,               ?,
               ?,              ?,            ?,          ?,            ?,
               ?,                ?,              ?,              ?,
               NOW(),     NOW())`,
      [
        case_id, case_name, case_number, attorney_email, paralegal_email, status,
        type_of_lawsuit, claim_amount, court_type, county_civil, remedies_sought,
        number_of_actions, is_class_action, related_case, jury_trial_demanded
      ]
    );

    return res.json({ success: true, id: insert.insertId, action: 'insert' });
  } catch (err) {
    console.error('❌ POST /lawsuits-auto upsert error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// READ (list)
router.get('/lawsuits-auto', async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM lawsuits_auto ORDER BY updated_at DESC LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ Error fetching lawsuits:', err.message);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// READ (single)
router.get('/lawsuits-auto/:id', async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM lawsuits_auto WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('❌ Error fetching lawsuit:', err.message);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});
router.get('/lawsuits-auto/case/:case_id', async (req, res) => {
  try {
    const caseId = req.params.case_id;

    const [rows] = await db.promise().query(
      `SELECT * FROM lawsuits_auto WHERE case_id = ? LIMIT 1`,
      [caseId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('❌ Error fetching case by case_id:', err.message);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// UPDATE
router.put('/lawsuits-auto/:id', async (req, res) => {
  try {
    const {
      case_id,
      case_name,
      attorney_email,
      paralegal_email,
      case_number,
      status: statusBody,
      filing_status,
      FilingStatus,

      // New fields
      type_of_lawsuit,
      claim_amount,
      court_type,
      county_civil,
      remedies_sought,
      number_of_actions,
      is_class_action,
      related_case,
      jury_trial_demanded,
    } = req.body || {};

    const fields = [];
    const values = [];

    if (case_id !== undefined) { fields.push('case_id = ?'); values.push(String(case_id)); }
    if (case_name !== undefined) { fields.push('case_name = ?'); values.push(case_name || ''); }
    if (attorney_email !== undefined) { fields.push('attorney_email = ?'); values.push(attorney_email || ''); }
    if (paralegal_email !== undefined) { fields.push('paralegal_email = ?'); values.push(paralegal_email || ''); }
    if (case_number !== undefined) { fields.push('case_number = ?'); values.push(case_number || ''); }

    // Normalize status from any alias
    let raw = (statusBody ?? filing_status ?? FilingStatus ?? '').toString().toLowerCase().trim();
    if (raw === '' || raw === '__reset__') {
      fields.push('status = ?');
      values.push(''); // if you prefer NULL in DB, change to 'status = NULL' and don't push a value
    } else if (ALLOWED_STATUS.has(raw)) {
      fields.push('status = ?');
      values.push(raw);
    }

    // New fields — write only if provided (allow explicit null/empty => store NULL)
    if (type_of_lawsuit !== undefined) {
      fields.push('type_of_lawsuit = ?'); values.push(toNullIfEmpty(type_of_lawsuit));
    }
    if (claim_amount !== undefined) {
      fields.push('claim_amount = ?'); values.push(toNullIfEmpty(claim_amount));
    }
    if (court_type !== undefined) {
      fields.push('court_type = ?'); values.push(toNullIfEmpty(court_type));
    }
    if (county_civil !== undefined) {
      fields.push('county_civil = ?'); values.push(toNullIfEmpty(county_civil));
    }
    if (remedies_sought !== undefined) {
      fields.push('remedies_sought = ?'); values.push(toNullIfEmpty(remedies_sought));
    }
    if (number_of_actions !== undefined) {
      fields.push('number_of_actions = ?'); values.push(toIntOrNull(number_of_actions));
    }
    if (is_class_action !== undefined) {
      fields.push('is_class_action = ?'); values.push(toYesNoOrNull(is_class_action));
    }
    if (related_case !== undefined) {
      fields.push('related_case = ?'); values.push(toYesNoOrNull(related_case));
    }
    if (jury_trial_demanded !== undefined) {
      fields.push('jury_trial_demanded = ?'); values.push(toYesNoOrNull(jury_trial_demanded));
    }

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    const sql = `UPDATE lawsuits_auto SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    values.push(req.params.id);
    const [result] = await db.promise().query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    // Return the updated row so the client sees what actually saved
    const [rows] = await db.promise().query(`SELECT * FROM lawsuits_auto WHERE id = ?`, [req.params.id]);
    return res.json({ success: true, updated: result.affectedRows, data: rows?.[0] || null });
  } catch (err) {
    console.error('❌ Error updating lawsuit:', err.message);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// DELETE
router.delete('/lawsuits-auto/:id', async (req, res) => {
  try {
    const [result] = await db.promise().query(
      `DELETE FROM lawsuits_auto WHERE id = ?`,
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error('❌ Error deleting lawsuit:', err.message);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// ==============================
// Response to MDT (response_to_mdt) CRUD & Webhook
// ==============================

// // Fetch Response to MDT data
// router.get('/response_to_mdt', async (req, res) => {
//   const caseId = req.query.caseId ?? req.query.case_id;
//   if (!caseId) {
//     console.log('🔍 Fetch Response to MDT called with caseId:', caseId);
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }
//   console.log('🔍 Fetch Response to MDT called with caseId:', caseId);
//   try {
//     const [rows] = await db.promisePool.execute(
//       `SELECT
//          uid,
//          status,
//          created_at,
//          updated_at
//        FROM response_to_mdt
//        WHERE case_id = ?`,
//       [caseId]
//     );
//     console.log('🔍 Response to MDT query returned rows:', rows);
//     const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
//     // Return null if no record exists (this is expected for new cases)
//     if (!record) {
//       console.log('🔍 No Response to MDT record found for caseId:', caseId, '- returning null (expected for new cases)');
//       return res.json({ success: true, data: null });
//     }
//     console.log('🔍 Selected Response to MDT record to return:', record);
//     return res.json({ success: true, data: record });
//   } catch (err) {
//     console.error('❌  Fetch Response to MDT data error:', err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });

// // Upsert Response to MDT data
// router.post('/response_to_mdt', async (req, res) => {
//   console.log('📥 POST /automations/response_to_mdt body:', req.body);
//   const caseId = req.body.caseId ?? req.body.case_id;
//   const uid = req.body.uid ?? null;

//   if (!caseId) {
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }

//   try {
//     await db.promisePool.execute(
//       `INSERT INTO response_to_mdt (
//          case_id,
//          uid,
//          status,
//          created_at,
//          updated_at
//        ) VALUES (?, ?, 'pending', NOW(), NOW())
//        ON DUPLICATE KEY UPDATE
//          uid = VALUES(uid),
//          updated_at = NOW()`,
//       [caseId, uid]
//     );
//     console.log('💾 Response to MDT data saved for caseId:', caseId);
//     return res.json({ success: true, message: 'Response to MDT data saved' });
//   } catch (err) {
//     console.error('❌  Save Response to MDT data error:', err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });

// // Update Response to MDT status
// router.put('/response_to_mdt', async (req, res) => {
//   const caseId = req.body.caseId ?? req.body.case_id;
//   const status = req.body.status ?? 'pending';

//   if (!caseId) {
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }

//   try {
//     await db.promisePool.execute(
//       `UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?`,
//       [status, caseId]
//     );
//     console.log('💾 Response to MDT status updated for caseId:', caseId, 'to', status);
//     return res.json({ success: true, message: 'Response to MDT status updated' });
//   } catch (err) {
//     console.error('❌  Update Response to MDT status error:', err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });

// // Trigger Response to MDT via n8n (with caseId and documents)
// router.post('/response_to_mdt/trigger', async (req, res) => {
//   const { caseId, documents = [], uid } = req.body;
//   if (!caseId) {
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }

//   const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
//   console.log('▶️  Triggering Response to MDT webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

//   try {
//     // Create or update record - set status to loading first
//     try {
//       await db.promisePool.execute(
//         `INSERT INTO response_to_mdt (case_id, uid, status, created_at, updated_at)
//          VALUES (?, ?, 'loading', NOW(), NOW())
//          ON DUPLICATE KEY UPDATE
//            status = 'loading',
//            uid = VALUES(uid),
//            updated_at = NOW()`,
//         [caseId, uid || null]
//       );
//       console.log('💾 Response to MDT status set to loading for caseId', caseId);
//     } catch (e) {
//       console.warn('⚠️ Failed to set loading status before trigger:', e.message);
//     }

//     // Send caseId and documents to webhook
//     const payload = {
//       caseId,
//       documents: documents || []
//     };
    
//     const response = await axios.post(n8nUrl, payload);
//     console.log('✅  Response to MDT automation triggered:', response.status, response.data);
    
//     // Update status to completed after successful webhook
//     try {
//       await db.promisePool.execute(
//         'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
//         ['completed', caseId]
//       );
//       console.log('💾 Response to MDT status set to completed for caseId', caseId);
//     } catch (e) {
//       console.warn('⚠️ Failed to set completed status after trigger:', e.message);
//     }
    
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error('❌  Response to MDT trigger error:', err.response?.data || err.message);
    
//     // Update status to failed on error
//     try {
//       await db.promisePool.execute(
//         'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
//         ['failed', caseId]
//       );
//     } catch (e) {
//       console.warn('⚠️ Failed to set failed status:', e.message);
//     }
    
//     return res
//       .status(500)
//       .json({ success: false, message: 'Failed to trigger Response to MDT automation', details: err.message });
//   }
// });

// // Send webhook with selected documents
// router.post('/response_to_mdt/webhook', async (req, res) => {
//   const { caseId, uid, documents = [] } = req.body;

//   if (!caseId) {
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }

//   const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
//   console.log('▶️  Sending Response to MDT webhook with documents:', n8nUrl, 'with caseId:', caseId, 'documents:', documents.length);

//   try {
//     // Update status to loading
//     try {
//       await db.promisePool.execute(
//         'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
//         ['loading', caseId]
//       );
//       console.log('💾 Response to MDT status set to loading for caseId', caseId);
//     } catch (e) {
//       console.warn('⚠️ Failed to set loading status before webhook:', e.message);
//     }

//     // Build payload with documents
//     const payload = {
//       caseId,
//       uid: uid || null,
//       documents: documents || []
//     };

//     const response = await axios.post(n8nUrl, payload);
//     console.log('✅  Response to MDT webhook sent:', response.status, response.data);
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error('❌ Response to MDT webhook error for caseId', caseId, ':', err.response?.data || err.message);
    
//     // Update status to failed on error
//     try {
//       await db.promisePool.execute(
//         'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
//         ['failed', caseId]
//       );
//     } catch (e) {
//       console.warn('⚠️ Failed to set failed status:', e.message);
//     }
    
//     return res.status(500).json({ success: false, message: 'Failed to send Response to MDT webhook', details: err.message });
//   }
// });

// // Re-run Response to MDT: clear existing and trigger again via n8n
// router.post('/response_to_mdt/rerun', async (req, res) => {
//   const { caseId, uid } = req.body;
//   if (!caseId) {
//     return res.status(400).json({ success: false, message: 'Missing caseId' });
//   }

//   console.log('🔄 Re-run Response to MDT for caseId:', caseId);

//   try {
//     // Clear existing data (set status back to pending)
//     await db.promisePool.execute(
//       `UPDATE response_to_mdt SET status = 'pending', uid = ?, updated_at = NOW() WHERE case_id = ?`,
//       [uid || null, caseId]
//     );
//     console.log('🔄 Cleared existing Response to MDT data for caseId:', caseId);

//     // Trigger the automation
//     const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
//     const response = await axios.post(n8nUrl, { caseId });
//     console.log('✅  Response to MDT re-run triggered:', response.status, response.data);
//     return res.json({ success: true, data: response.data });
//   } catch (err) {
//     console.error('❌  Response to MDT re-run error:', err.response?.data || err.message);
//     return res
//       .status(500)
//       .json({ success: false, message: 'Failed to re-run Response to MDT automation', details: err.message });
//   }
// });
// Fetch Response to MDT data
router.get('/response_to_mdt', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Response to MDT called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Response to MDT called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         uid,
         status,
         created_at,
         updated_at
       FROM response_to_mdt
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Response to MDT query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    // Return null if no record exists (this is expected for new cases)
    if (!record) {
      console.log('🔍 No Response to MDT record found for caseId:', caseId, '- returning null (expected for new cases)');
      return res.json({ success: true, data: null });
    }
    console.log('🔍 Selected Response to MDT record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Response to MDT data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Response to MDT data
router.post('/response_to_mdt', async (req, res) => {
  console.log('📥 POST /automations/response_to_mdt body:', req.body);
  const caseId = req.body.caseId ?? req.body.case_id;
  const uid = req.body.uid ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO response_to_mdt (
         case_id,
         uid,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, 'pending', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         uid = VALUES(uid),
         updated_at = NOW()`,
      [caseId, uid]
    );
    console.log('💾 Response to MDT data saved for caseId:', caseId);
    return res.json({ success: true, message: 'Response to MDT data saved' });
  } catch (err) {
    console.error('❌  Save Response to MDT data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET by case ID in path (for n8n: GET /automations/response-to-mdt/cases/:caseId)
router.get('/response-to-mdt/cases/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         uid,
         status,
         created_at,
         updated_at
       FROM response_to_mdt
       WHERE case_id = ?`,
      [caseId]
    );
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    if (!record) {
      return res.json({ success: true, data: null });
    }
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Response to MDT data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Response to MDT status
const updateResponseToMdtStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 Response to MDT status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'Response to MDT status updated' });
  } catch (err) {
    console.error('❌  Update Response to MDT status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
router.put('/response_to_mdt', updateResponseToMdtStatus);
router.post('/response_to_mdt', updateResponseToMdtStatus); // Also accept POST for n8n
// Also handle hyphenated version for n8n compatibility
router.put('/response-to-mdt', updateResponseToMdtStatus);
router.post('/response-to-mdt', updateResponseToMdtStatus); // n8n calls this with POST
// Trigger Response to MDT via n8n (with caseId and documents)
router.post('/response_to_mdt/trigger', async (req, res) => {
  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
  console.log('▶️  Triggering Response to MDT webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like lawsuits)
    try {
      await db.promisePool.execute(
        `INSERT INTO response_to_mdt (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 Response to MDT status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook
    const payload = {
      caseId,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  Response to MDT automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will call PUT /automations/response_to_mdt to update status to 'filed' when complete
    // Status remains 'pending' until n8n workflow completes and calls the PUT endpoint
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Response to MDT trigger error:', err.response?.data || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Response to MDT automation', details: err.message });
  }
});

// Send webhook with selected documents
router.post('/response_to_mdt/webhook', async (req, res) => {
  const { caseId, uid, documents = [] } = req.body;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
  console.log('▶️  Sending Response to MDT webhook with documents:', n8nUrl, 'with caseId:', caseId, 'documents:', documents.length);

  try {
    // Update status to loading
    try {
      await db.promisePool.execute(
        'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['loading', caseId]
      );
      console.log('💾 Response to MDT status set to loading for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set loading status before webhook:', e.message);
    }

    // Build payload with documents
    const payload = {
      caseId,
      uid: uid || null,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  Response to MDT webhook sent:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Response to MDT webhook error for caseId', caseId, ':', err.response?.data || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE response_to_mdt SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res.status(500).json({ success: false, message: 'Failed to send Response to MDT webhook', details: err.message });
  }
});
// Delete Response to MDT record (reset to empty — back to trigger step)
router.delete('/response_to_mdt', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  try {
    await db.promisePool.execute('DELETE FROM response_to_mdt WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Response to MDT entries deleted' });
  } catch (err) {
    console.error('❌ Delete Response to MDT error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
// Send selected documents to UiPath via n8n (for Response to MDT)
router.post('/response_to_mdt/ui-path-trigger', async (req, res) => {
  const { caseId, documents = [] } = req.body;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ success: false, message: 'documents array is required and must not be empty' });
  }

  const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_UIPATH_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook-test/response-to-mdt-ui-path-trigger';
  console.log('▶️  Triggering Response to MDT UiPath webhook:', n8nUrl, 'caseId:', caseId, 'docs:', documents.length);

  try {
    const response = await axios.post(n8nUrl, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    console.log('✅  Response to MDT UiPath webhook response:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const status = err.response?.status || 500;
    const details = err.response?.data || err.message;
    console.error('❌  Response to MDT UiPath trigger error:', details);
    return res
      .status(status)
      .json({ success: false, message: 'Failed to trigger Response to MDT UiPath webhook', details });
  }
});

// Re-run Response to MDT: clear existing and trigger again via n8n
router.post('/response_to_mdt/rerun', async (req, res) => {
  const { caseId, uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  console.log('🔄 Re-run Response to MDT for caseId:', caseId);

  try {
    // Clear existing data (set status back to pending)
    await db.promisePool.execute(
      `UPDATE response_to_mdt SET status = 'pending', uid = ?, updated_at = NOW() WHERE case_id = ?`,
      [uid || null, caseId]
    );
    console.log('🔄 Cleared existing Response to MDT data for caseId:', caseId);

    // Trigger the automation
    const n8nUrl = process.env.N8N_RESPONSE_TO_MDT_WEBHOOK_URL || 'https://n8n.louislawgroup.com/webhook/response-to-mdt';
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Response to MDT re-run triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Response to MDT re-run error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to re-run Response to MDT automation', details: err.message });
  }
});


    // DUTY to ADJUST LETTER CRUD


router.get('/duty_to_adjust_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
        plaintiff,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        insurance_company,
        client_phone,
        send_to,
        public_adjuster,
        uid,
        uipath_uid,
        rerun_uid,
        firsttrigger_uid,
        status,
        created_at,
        updated_at
      FROM duty_to_adjust_letter
      WHERE case_id = ?`,
      [caseId]
    );

    const record =
      rows.find(r => String(r.status).toLowerCase() === 'pending') ||
      (rows.length ? rows[0] : null);

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌ Fetch Duty To Adjust Letter error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/duty_to_adjust_letter', async (req, res) => {
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

  const caseId = req.body.caseId ?? req.body.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  const {
    plaintiff = null,
    claim_number = null,
    policy_number = null,
    premises = null,
    date_of_loss = null,
    loss_type = null,
    insurance_company = null,
    client_phone = null,
    send_to = null,
    public_adjuster = null
  } = req.body;

  try {
    await db.promisePool.execute(
      `INSERT INTO duty_to_adjust_letter (
        case_id, uid, plaintiff, claim_number, policy_number,
        premises, date_of_loss, loss_type, insurance_company,
        client_phone, send_to, public_adjuster,
        status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
      )
      ON DUPLICATE KEY UPDATE
        uid               = VALUES(uid),
        plaintiff         = VALUES(plaintiff),
        claim_number      = VALUES(claim_number),
        policy_number     = VALUES(policy_number),
        premises          = VALUES(premises),
        date_of_loss      = VALUES(date_of_loss),
        loss_type         = VALUES(loss_type),
        insurance_company = VALUES(insurance_company),
        client_phone      = VALUES(client_phone),
        send_to           = VALUES(send_to),
        public_adjuster   = VALUES(public_adjuster),
        updated_at        = NOW()`,
      [
        caseId, uid, plaintiff, claim_number, policy_number,
        premises, date_of_loss, loss_type, insurance_company,
        client_phone, send_to, public_adjuster
      ]
    );

    return res.json({ success: true, message: 'Duty To Adjust Letter saved' });
  } catch (err) {
    console.error('❌ Duty To Adjust Letter save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/duty_to_adjust_letter', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id;
    let raw = (req.body.status ?? req.query.status ?? '').toLowerCase().trim();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw) return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;

    const ALLOWED = new Set(['pending','loading','completed','failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status ${raw}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE duty_to_adjust_letter SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Case not found' });

    return res.json({ success: true, status });
  } catch (err) {
    console.error('❌ Duty To Adjust Letter status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/duty_to_adjust_letter/status', async (req, res) => {
  return router.handle(req, res);
});

router.delete('/duty_to_adjust_letter/:caseId', async (req, res) => {
  const { caseId } = req.params;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute('DELETE FROM duty_to_adjust_letter WHERE case_id = ?', [caseId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Duty To Adjust Letter delete error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/duty_to_adjust_letter/trigger', async (req, res) => {
  const { caseId, uid } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/duty-to-adjust-letter';

  try {
    if (uid) {
      await db.promisePool.execute(
        'UPDATE duty_to_adjust_letter SET firsttrigger_uid = ? WHERE case_id = ?',
        [uid, caseId]
      );
    }

    const response = await axios.post(n8nUrl, { caseId });
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Duty To Adjust trigger error:', err.response?.data || err.message);
    return res.status(500).json({ success: false });
  }
});

router.post('/duty_to_adjust_letter/rerun', async (req, res) => {
  const { caseId, uid } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    if (uid) {
      await db.promisePool.execute(
        'UPDATE duty_to_adjust_letter SET rerun_uid = ? WHERE case_id = ?',
        [uid, caseId]
      );
    }

    await db.promisePool.execute(
      'DELETE FROM duty_to_adjust_letter WHERE case_id = ?',
      [caseId]
    );

    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/duty-to-adjust-letter';
    await axios.post(n8nUrl, { caseId });

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Duty To Adjust rerun error:', err);
    return res.status(500).json({ success: false });
  }
});


router.post('/duty_to_adjust_letter/queue', async (req, res) => {
  const { caseId, uid, documents = [] } = req.body;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE duty_to_adjust_letter SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
  } catch (e) {
    console.warn('⚠️ Failed to mark loading:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/duty-to-adjust-letter-email';

  try {
    const response = await axios.post(n8nUrl, { ...req.body, documents });
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Duty To Adjust UiPath error:', err.response?.data || err.message);
    return res.status(500).json({ success: false });
  }
});


// ==============================
// LOR to IC (lor_to_ic) CRUD & UiPath queue
// ==============================

// Fetch LOR to IC data
router.get('/lor_to_ic', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch LOR to IC called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch LOR to IC called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         send_to,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM lor_to_ic
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 LOR to IC query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected LOR to IC record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch LOR to IC data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert LOR to IC data
router.post('/lor_to_ic', async (req, res) => {
  console.log('📥 POST /automations/lor_to_ic body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 LOR to IC upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const loss_type = req.body.loss_type ?? null;
  const client_email = req.body.client_email ?? null;
  const attorney_email = req.body.attorney_email ?? null;
  const paralegal_email = req.body.paralegal_email ?? null;
  const send_to = req.body.send_to ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO lor_to_ic (
         case_id,
         uid,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         loss_type,
         client_email,
         attorney_email,
         paralegal_email,
         send_to,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                  = VALUES(uid),
         claim_number         = VALUES(claim_number),
         policy_number        = VALUES(policy_number),
         premises             = VALUES(premises),
         date_of_loss         = VALUES(date_of_loss),
         loss_type            = VALUES(loss_type),
         client_email         = VALUES(client_email),
         attorney_email       = VALUES(attorney_email),
         paralegal_email      = VALUES(paralegal_email),
         send_to              = VALUES(send_to),
         status               = VALUES(status),
         updated_at           = NOW()
      `,
      [
        caseId,
        uid,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        loss_type,
        client_email,
        attorney_email,
        paralegal_email,
        send_to
      ]
    );

    return res.json({ success: true, message: 'LOR to IC data saved' });
  } catch (err) {
    console.error('❌  LOR to IC data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update LOR to IC status
router.put('/lor_to_ic', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to IC status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to IC status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to IC status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for status update
router.put('/lor_to_ic/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated LOR to IC status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'LOR to IC status updated', status });
  } catch (err) {
    console.error('❌  Update LOR to IC status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete LOR to IC entries
router.delete('/lor_to_ic', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to IC entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to IC entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/lor_to_ic/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'LOR to IC entries deleted' });
  } catch (err) {
    console.error('❌  Delete LOR to IC entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger LOR to IC via n8n
router.post('/lor_to_ic/trigger', async (req, res) => {
  // --- Caller audit for LOR to IC trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 LOR to IC /lor_to_ic/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log LOR to IC trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://dev.louislawgroup.com/automations/lor_to_ic';
  console.log('▶️  Triggering LOR to IC webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  LOR to IC automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  LOR to IC trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger LOR to IC automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  LOR to IC trigger error:', errorData || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger LOR to IC automation', details: err.message });
  }
});

// Re-run LOR to IC: clear existing and trigger again via n8n
router.post('/lor_to_ic/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing LOR to IC entries for this case
    await db.promisePool.execute('DELETE FROM lor_to_ic WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing LOR to IC entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://dev.louislawgroup.com/automations/lor_to_ic';
    if (!n8nUrl) {
      console.error('❌  LOR to IC webhook URL is not configured');
      return res.status(500).json({ success: false, message: 'N8N webhook URL not configured' });
    }

    console.log('▶️ Re-triggering LOR to IC webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run LOR to IC automation triggered:', response.status);

    return res.json({ success: true, message: 'LOR to IC re-run triggered' });
  } catch (err) {
    console.error('❌  LOR to IC re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit LOR to IC to UiPath via n8n webhook
router.post('/lor_to_ic/queue', async (req, res) => {
  const {
    caseId,
    uid,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    loss_type,
    client_email,
    attorney_email,
    paralegal_email,
    send_to
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE lor_to_ic SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 LOR to IC status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing LOR to IC:', e.message);
  }

  // Use hardcoded n8n webhook URL for UiPath submission
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-ic-email';
  // const n8nUrl = 'https://n8n.louislawgroup.com/webhook/lor-to-ic-uipath';
  console.log('▶️  Submitting LOR to IC to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const payload = {
      caseId,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      loss_type,
      client_email,
      attorney_email,
      paralegal_email,
      send_to,
      uid
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ LOR to IC UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ LOR to IC UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit LOR to IC to UiPath', details: err.message });
  }
});

// ==============================
// SAL Request English (sal_request_english) CRUD & UiPath queue
// ==============================

// Fetch SAL Request English data
router.get('/sal_request_english', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch SAL Request English called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch SAL Request English called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM sal_request_english
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 SAL Request English query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected SAL Request English record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch SAL Request English data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert SAL Request English data
router.post('/sal_request_english', async (req, res) => {
  console.log('📥 POST /automations/sal_request_english body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 SAL Request English upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO sal_request_english (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ SAL Request English upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'SAL Request English saved' });
  } catch (err) {
    console.error('❌  SAL Request English upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n to call: /automations/SAL-English (receives data from n8n workflow)
// Handle both uppercase and lowercase versions for compatibility
router.post('/sal-english', async (req, res) => {
  console.log('📥 POST /automations/SAL-English body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 SAL Request English upsert uid (via SAL-English alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  const assigned_attorney_email = req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO sal_request_english (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ SAL Request English upsert successful for caseId', caseId, '(via SAL-English alias)');
    return res.json({ success: true, message: 'SAL Request English saved' });
  } catch (err) {
    console.error('❌  SAL Request English upsert error (via SAL-English alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Also register lowercase version for compatibility
router.post('/sal-english', async (req, res) => {
  console.log('📥 POST /automations/sal-english body (lowercase alias):', req.body);
  // Reuse the same handler logic
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 SAL Request English upsert uid (via sal-english alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO sal_request_english (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email
      ]
    );
    console.log('✅ SAL Request English upsert successful for caseId', caseId, '(via sal-english alias)');
    return res.json({ success: true, message: 'SAL Request English saved' });
  } catch (err) {
    console.error('❌  SAL Request English upsert error (via sal-english alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update SAL Request English status
// Update SAL Request English status (PUT and POST for n8n compatibility)
const updateSalRequestEnglishStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE sal_request_english SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 SAL Request English status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'SAL Request English status updated' });
  } catch (err) {
    console.error('❌  Update SAL Request English status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/sal_request_english', updateSalRequestEnglishStatus);
// Also handle hyphenated version for n8n compatibility (POST only, to avoid conflict with main POST route)
router.post('/sal-english', updateSalRequestEnglishStatus); // n8n calls this with POST
router.put('/sal-english', updateSalRequestEnglishStatus);

// Delete SAL Request English entries
router.delete('/sal_request_english', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM sal_request_english WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'SAL Request English entries deleted' });
  } catch (err) {
    console.error('❌  Delete SAL Request English entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger SAL Request English via n8n (with caseId and documents)
router.post('/sal_request_english/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 SAL Request English /sal_request_english/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log SAL Request English trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/SAL-English';
  console.log('▶️  Triggering SAL Request English webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like response_to_mdt)
    try {
      await db.promisePool.execute(
        `INSERT INTO sal_request_english (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 SAL Request English status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook
    const payload = {
      caseId,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  SAL Request English automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will update status when complete
    // Status remains 'pending' until n8n workflow completes
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  SAL Request English trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger SAL Request English automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  SAL Request English trigger error:', errorData || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE sal_request_english SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger SAL Request English automation', details: err.message });
  }
});

// Re-run SAL Request English
router.post('/sal_request_english/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM sal_request_english WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing SAL Request English entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/sal_request_english';
    console.log('▶️ Re-triggering SAL Request English webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run SAL Request English automation triggered:', response.status);

    return res.json({ success: true, message: 'SAL Request English re-run triggered' });
  } catch (err) {
    console.error('❌  SAL Request English re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit SAL Request English to UiPath via n8n webhook
router.post('/sal_request_english/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE sal_request_english SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 SAL Request English status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing SAL Request English:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/sal-english-Email';
  console.log('▶️  Submitting SAL Request English to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email, // Map to n8n field name
      paralegal_email: paralegal_assignment_email, // Map to n8n field name
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ SAL Request English UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ SAL Request English UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit SAL Request English to UiPath', details: err.message });
  }
});

// SAL Request Spanish (sal_request_spanish) CRUD & UiPath queue
// ==============================

// Fetch SAL Request Spanish data
router.get('/sal_request_spanish', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch SAL Request Spanish called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch SAL Request Spanish called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM sal_request_spanish
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 SAL Request Spanish query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected SAL Request Spanish record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch SAL Request Spanish data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert SAL Request Spanish data
router.post('/sal_request_spanish', async (req, res) => {
  console.log('📥 POST /automations/sal_request_spanish body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 SAL Request Spanish upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO sal_request_spanish (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ SAL Request Spanish upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'SAL Request Spanish saved' });
  } catch (err) {
    console.error('❌  SAL Request Spanish upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n to call: /automations/SAL-Spanish (receives data from n8n workflow)
// Handle both uppercase and lowercase versions for compatibility
router.post('/sal-spanish', async (req, res) => {
  console.log('📥 POST /automations/SAL-Spanish body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 SAL Request Spanish upsert uid (via SAL-Spanish alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO sal_request_spanish (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ SAL Request Spanish upsert successful for caseId', caseId, '(via SAL-Spanish alias)');
    return res.json({ success: true, message: 'SAL Request Spanish saved' });
  } catch (err) {
    console.error('❌  SAL Request Spanish upsert error (via SAL-Spanish alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update SAL Request Spanish status
// Update SAL Request Spanish status (PUT and POST for n8n compatibility)
const updateSalRequestSpanishStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE sal_request_spanish SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 SAL Request Spanish status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'SAL Request Spanish status updated' });
  } catch (err) {
    console.error('❌  Update SAL Request Spanish status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/sal_request_spanish', updateSalRequestSpanishStatus);
// Also handle hyphenated version for n8n compatibility (POST only, to avoid conflict with main POST route)
router.post('/sal-spanish', updateSalRequestSpanishStatus); // n8n calls this with POST
router.put('/sal-spanish', updateSalRequestSpanishStatus);

// Delete SAL Request Spanish entries
router.delete('/sal_request_spanish', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM sal_request_spanish WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'SAL Request Spanish entries deleted' });
  } catch (err) {
    console.error('❌  Delete SAL Request Spanish entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger SAL Request Spanish via n8n (with caseId and documents)
router.post('/sal_request_spanish/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 SAL Request Spanish /sal_request_spanish/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log SAL Request Spanish trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/SAL-spanish';
  console.log('▶️  Triggering SAL Request Spanish webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like response_to_mdt)
    try {
      await db.promisePool.execute(
        `INSERT INTO sal_request_spanish (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 SAL Request Spanish status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook
    const payload = {
      caseId,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  SAL Request Spanish automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will update status when complete
    // Status remains 'pending' until n8n workflow completes
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  SAL Request Spanish trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger SAL Request Spanish automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  SAL Request Spanish trigger error:', errorData || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE sal_request_spanish SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger SAL Request Spanish automation', details: err.message });
  }
});

// Re-run SAL Request Spanish
router.post('/sal_request_spanish/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM sal_request_spanish WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing SAL Request Spanish entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/sal_request_spanish';
    console.log('▶️ Re-triggering SAL Request Spanish webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run SAL Request Spanish automation triggered:', response.status);

    return res.json({ success: true, message: 'SAL Request Spanish re-run triggered' });
  } catch (err) {
    console.error('❌  SAL Request Spanish re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit SAL Request Spanish to UiPath via n8n webhook
router.post('/sal_request_spanish/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE sal_request_spanish SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 SAL Request Spanish status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing SAL Request Spanish:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/sal-spanish-Email';
  console.log('▶️  Submitting SAL Request Spanish to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email, // Map to n8n field name
      paralegal_email: paralegal_assignment_email, // Map to n8n field name
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ SAL Request Spanish UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ SAL Request Spanish UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit SAL Request Spanish to UiPath', details: err.message });
  }
});

// ==============================
// PFS Letter to Client (pfs_letter_to_client) CRUD & UiPath queue
// ==============================

// Fetch PFS Letter to Client data
router.get('/pfs_letter_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch PFS Letter to Client called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch PFS Letter to Client called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM pfs_letter_to_client
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 PFS Letter to Client query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected PFS Letter to Client record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch PFS Letter to Client data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert PFS Letter to Client data
router.post('/pfs_letter_to_client', async (req, res) => {
  console.log('📥 POST /automations/pfs_letter_to_client body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS Letter to Client upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS Letter to Client upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'PFS Letter to Client saved' });
  } catch (err) {
    console.error('❌  PFS Letter to Client upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n to call: /automations/PFS-Letter-to-Client (receives data from n8n workflow)
// Handle both uppercase and lowercase versions for compatibility
router.post('/PFS-Letter-to-Client', async (req, res) => {
  console.log('📥 POST /automations/PFS-Letter-to-Client body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS Letter to Client upsert uid (via PFS-Letter-to-Client alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS Letter to Client upsert successful for caseId', caseId, '(via PFS-Letter-to-Client alias)');
    return res.json({ success: true, message: 'PFS Letter to Client saved' });
  } catch (err) {
    console.error('❌  PFS Letter to Client upsert error (via PFS-Letter-to-Client alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Also register lowercase version for compatibility
router.post('/pfs-letter-to-client', async (req, res) => {
  console.log('📥 POST /automations/pfs-letter-to-client body (lowercase alias):', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS Letter to Client upsert uid (via pfs-letter-to-client alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS Letter to Client upsert successful for caseId', caseId, '(via pfs-letter-to-client alias)');
    return res.json({ success: true, message: 'PFS Letter to Client saved' });
  } catch (err) {
    console.error('❌  PFS Letter to Client upsert error (via pfs-letter-to-client alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update PFS Letter to Client status
const updatePfsLetterToClientStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE pfs_letter_to_client SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 PFS Letter to Client status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'PFS Letter to Client status updated' });
  } catch (err) {
    console.error('❌  Update PFS Letter to Client status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/pfs_letter_to_client', updatePfsLetterToClientStatus);
// Also handle hyphenated versions for n8n compatibility
router.post('/PFS-Letter-to-Client', updatePfsLetterToClientStatus); // n8n calls this with POST
router.put('/PFS-Letter-to-Client', updatePfsLetterToClientStatus);
router.post('/pfs-letter-to-client', updatePfsLetterToClientStatus);
router.put('/pfs-letter-to-client', updatePfsLetterToClientStatus);

// Delete PFS Letter to Client entries
router.delete('/pfs_letter_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM pfs_letter_to_client WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'PFS Letter to Client entries deleted' });
  } catch (err) {
    console.error('❌  Delete PFS Letter to Client entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger PFS Letter to Client via n8n (with caseId and documents)
router.post('/pfs_letter_to_client/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 PFS Letter to Client /pfs_letter_to_client/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log PFS Letter to Client trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/PFS-Letter-to-Client';
  console.log('▶️  Triggering PFS Letter to Client webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like response_to_mdt)
    try {
      await db.promisePool.execute(
        `INSERT INTO pfs_letter_to_client (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 PFS Letter to Client status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook
    const payload = {
      caseId,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  PFS Letter to Client automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will update status when complete
    // Status remains 'pending' until n8n workflow completes
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  PFS Letter to Client trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger PFS Letter to Client automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  PFS Letter to Client trigger error:', errorData || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE pfs_letter_to_client SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger PFS Letter to Client automation', details: err.message });
  }
});

// Re-run PFS Letter to Client
router.post('/pfs_letter_to_client/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM pfs_letter_to_client WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing PFS Letter to Client entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/pfs_letter_to_client';
    console.log('▶️ Re-triggering PFS Letter to Client webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run PFS Letter to Client automation triggered:', response.status);

    return res.json({ success: true, message: 'PFS Letter to Client re-run triggered' });
  } catch (err) {
    console.error('❌  PFS Letter to Client re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit PFS Letter to Client to UiPath via n8n webhook
router.post('/pfs_letter_to_client/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE pfs_letter_to_client SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 PFS Letter to Client status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing PFS Letter to Client:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/PFS-Letter-to-Client-Email';
  console.log('▶️  Submitting PFS Letter to Client to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email, // Map to n8n field name
      paralegal_email: paralegal_assignment_email, // Map to n8n field name
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ PFS Letter to Client UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ PFS Letter to Client UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit PFS Letter to Client to UiPath', details: err.message });
  }
});

// ==============================
// PFS to Client in Spanish (pfs_to_client_spanish) CRUD & UiPath queue
// ==============================

// Fetch PFS to Client in Spanish data
router.get('/pfs_to_client_spanish', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch PFS to Client in Spanish called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch PFS to Client in Spanish called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM pfs_to_client_spanish
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 PFS to Client in Spanish query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected PFS to Client in Spanish record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch PFS to Client in Spanish data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert PFS to Client in Spanish data
router.post('/pfs_to_client_spanish', async (req, res) => {
  console.log('📥 POST /automations/pfs_to_client_spanish body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Client in Spanish upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // Accept status from n8n, default to pending for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_client_spanish (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email          = VALUES(assigned_attorney_email),
         paralegal_assignment_email       = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS to Client in Spanish upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'PFS to Client in Spanish saved' });
  } catch (err) {
    console.error('❌  PFS to Client in Spanish upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n compatibility
router.post('/PFS-to-Client-Spanish', async (req, res) => {
  console.log('📥 POST /automations/PFS-to-Client-Spanish body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Client in Spanish upsert uid (via alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_client_spanish (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email          = VALUES(assigned_attorney_email),
         paralegal_assignment_email       = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS to Client in Spanish upsert successful for caseId', caseId, '(via alias)');
    return res.json({ success: true, message: 'PFS to Client in Spanish saved' });
  } catch (err) {
    console.error('❌  PFS to Client in Spanish upsert error (via alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Lowercase hyphenated alias
router.post('/pfs-to-client-spanish', async (req, res) => {
  console.log('📥 POST /automations/pfs-to-client-spanish body (lowercase alias):', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Client in Spanish upsert uid (via lowercase alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_client_spanish (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email          = VALUES(assigned_attorney_email),
         paralegal_assignment_email       = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ PFS to Client in Spanish upsert successful for caseId', caseId, '(via lowercase alias)');
    return res.json({ success: true, message: 'PFS to Client in Spanish saved' });
  } catch (err) {
    console.error('❌  PFS to Client in Spanish upsert error (via lowercase alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update PFS to Client in Spanish status
const updatePfsToClientSpanishStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE pfs_to_client_spanish SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 PFS to Client in Spanish status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'PFS to Client in Spanish status updated' });
  } catch (err) {
    console.error('❌  Update PFS to Client in Spanish status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/pfs_to_client_spanish', updatePfsToClientSpanishStatus);
router.post('/PFS-to-Client-Spanish', updatePfsToClientSpanishStatus);
router.put('/PFS-to-Client-Spanish', updatePfsToClientSpanishStatus);
router.post('/pfs-to-client-spanish', updatePfsToClientSpanishStatus);
router.put('/pfs-to-client-spanish', updatePfsToClientSpanishStatus);

// Delete PFS to Client in Spanish entries
router.delete('/pfs_to_client_spanish', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM pfs_to_client_spanish WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'PFS to Client in Spanish entries deleted' });
  } catch (err) {
    console.error('❌  Delete PFS to Client in Spanish entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger PFS to Client in Spanish via n8n (with caseId and documents)
router.post('/pfs_to_client_spanish/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 PFS to Client in Spanish /pfs_to_client_spanish/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log PFS to Client in Spanish trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/pfs-letter-to-client-spnish';
  console.log('▶️  Triggering PFS to Client in Spanish webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    try {
      await db.promisePool.execute(
        `INSERT INTO pfs_to_client_spanish (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 PFS to Client in Spanish status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    const payload = {
      caseId,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  PFS to Client in Spanish automation triggered:', response.status, response.data);

    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;

    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  PFS to Client in Spanish trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({
          success: false,
          message: 'Failed to trigger PFS to Client in Spanish automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }

    console.error('❌  PFS to Client in Spanish trigger error:', errorData || err.message);

    try {
      await db.promisePool.execute(
        'UPDATE pfs_to_client_spanish SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }

    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger PFS to Client in Spanish automation', details: err.message });
  }
});

// Re-run PFS to Client in Spanish
router.post('/pfs_to_client_spanish/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM pfs_to_client_spanish WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing PFS to Client in Spanish entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/pfs_to_client_spanish';
    console.log('▶️ Re-triggering PFS to Client in Spanish webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run PFS to Client in Spanish automation triggered:', response.status);

    return res.json({ success: true, message: 'PFS to Client in Spanish re-run triggered' });
  } catch (err) {
    console.error('❌  PFS to Client in Spanish re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit PFS to Client in Spanish to UiPath via n8n webhook
router.post('/pfs_to_client_spanish/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE pfs_to_client_spanish SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 PFS to Client in Spanish status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing PFS to Client in Spanish:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/PFS-Letter-to-Client-Email-spanish';
  console.log('▶️  Submitting PFS to Client in Spanish to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email,
      paralegal_email: paralegal_assignment_email,
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ PFS to Client in Spanish UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ PFS to Client in Spanish UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit PFS to Client in Spanish to UiPath', details: err.message });
  }
});

// ==============================
// PFS to Defendant (pfs_to_defendant) CRUD & UiPath queue
// ==============================

// Fetch PFS to Defendant data
router.get('/pfs_to_defendant', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch PFS to Defendant called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch PFS to Defendant called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         court_type,
         pfs_offer,
         ocs_service_email,
         ocs_direct_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM pfs_to_defendant
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 PFS to Defendant query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected PFS to Defendant record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch PFS to Defendant data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert PFS to Defendant data
router.post('/pfs_to_defendant', async (req, res) => {
  console.log('📥 POST /automations/pfs_to_defendant body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Defendant upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const court_type = req.body.court_type ?? null;
  const pfs_offer = req.body.pfs_offer ?? null;
  const ocs_service_email = req.body.ocs_service_email ?? null;
  const ocs_direct_email = req.body.ocs_direct_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_defendant (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         court_type,
         pfs_offer,
         ocs_service_email,
         ocs_direct_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         court_type                       = VALUES(court_type),
         pfs_offer                        = VALUES(pfs_offer),
         ocs_service_email                = VALUES(ocs_service_email),
         ocs_direct_email                 = VALUES(ocs_direct_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        court_type,
        pfs_offer,
        ocs_service_email,
        ocs_direct_email,
        status
      ]
    );
    console.log('✅ PFS to Defendant upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'PFS to Defendant saved' });
  } catch (err) {
    console.error('❌  PFS to Defendant upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n to call: /automations/PFS-to-defendant (receives data from n8n workflow)
// Handle both uppercase and lowercase versions for compatibility
router.post('/PFS-to-defendant', async (req, res) => {
  console.log('📥 POST /automations/PFS-to-defendant body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Defendant upsert uid (via PFS-to-defendant alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const court_type = req.body.court_type ?? null;
  const pfs_offer = req.body.pfs_offer ?? null;
  const ocs_service_email = req.body.ocs_service_email ?? null;
  const ocs_direct_email = req.body.ocs_direct_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_defendant (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         court_type,
         pfs_offer,
         ocs_service_email,
         ocs_direct_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         court_type                       = VALUES(court_type),
         pfs_offer                        = VALUES(pfs_offer),
         ocs_service_email                = VALUES(ocs_service_email),
         ocs_direct_email                 = VALUES(ocs_direct_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        court_type,
        pfs_offer,
        ocs_service_email,
        ocs_direct_email,
        status
      ]
    );
    console.log('✅ PFS to Defendant upsert successful for caseId', caseId, '(via PFS-to-defendant alias)');
    return res.json({ success: true, message: 'PFS to Defendant saved' });
  } catch (err) {
    console.error('❌  PFS to Defendant upsert error (via PFS-to-defendant alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Also register lowercase version for compatibility
router.post('/pfs-to-defendant', async (req, res) => {
  console.log('📥 POST /automations/pfs-to-defendant body (lowercase alias):', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 PFS to Defendant upsert uid (via pfs-to-defendant alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const court_type = req.body.court_type ?? null;
  const pfs_offer = req.body.pfs_offer ?? null;
  const ocs_service_email = req.body.ocs_service_email ?? null;
  const ocs_direct_email = req.body.ocs_direct_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO pfs_to_defendant (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         court_type,
         pfs_offer,
         ocs_service_email,
         ocs_direct_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         court_type                       = VALUES(court_type),
         pfs_offer                        = VALUES(pfs_offer),
         ocs_service_email                = VALUES(ocs_service_email),
         ocs_direct_email                 = VALUES(ocs_direct_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        court_type,
        pfs_offer,
        ocs_service_email,
        ocs_direct_email,
        status
      ]
    );
    console.log('✅ PFS to Defendant upsert successful for caseId', caseId, '(via pfs-to-defendant alias)');
    return res.json({ success: true, message: 'PFS to Defendant saved' });
  } catch (err) {
    console.error('❌  PFS to Defendant upsert error (via pfs-to-defendant alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update PFS to Defendant status
const updatePfsToDefendantStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE pfs_to_defendant SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 PFS to Defendant status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'PFS to Defendant status updated' });
  } catch (err) {
    console.error('❌  Update PFS to Defendant status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/pfs_to_defendant', updatePfsToDefendantStatus);
// Also handle hyphenated versions for n8n compatibility
router.post('/PFS-to-defendant', updatePfsToDefendantStatus); // n8n calls this with POST
router.put('/PFS-to-defendant', updatePfsToDefendantStatus);
router.post('/pfs-to-defendant', updatePfsToDefendantStatus);
router.put('/pfs-to-defendant', updatePfsToDefendantStatus);

// Delete PFS to Defendant entries
router.delete('/pfs_to_defendant', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM pfs_to_defendant WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'PFS to Defendant entries deleted' });
  } catch (err) {
    console.error('❌  Delete PFS to Defendant entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger PFS to Defendant via n8n (with caseId and documents)
router.post('/pfs_to_defendant/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 PFS to Defendant /pfs_to_defendant/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log PFS to Defendant trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid, court_type = null, pfs_offer = null } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/PFS-Letter-to-Defendant';
  console.log('▶️  Triggering PFS to Defendant webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like response_to_mdt)
    try {
      await db.promisePool.execute(
        `INSERT INTO pfs_to_defendant (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 PFS to Defendant status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook
    const payload = {
      caseId,
      court_type,
      pfs_offer,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  PFS to Defendant automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will update status when complete
    // Status remains 'pending' until n8n workflow completes
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  PFS to Defendant trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger PFS to Defendant automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  PFS to Defendant trigger error:', errorData || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE pfs_to_defendant SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger PFS to Defendant automation', details: err.message });
  }
});

// Re-run PFS to Defendant
router.post('/pfs_to_defendant/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM pfs_to_defendant WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing PFS to Defendant entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/pfs_to_defendant';
    console.log('▶️ Re-triggering PFS to Defendant webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run PFS to Defendant automation triggered:', response.status);

    return res.json({ success: true, message: 'PFS to Defendant re-run triggered' });
  } catch (err) {
    console.error('❌  PFS to Defendant re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit PFS to Defendant to UiPath via n8n webhook
router.post('/pfs_to_defendant/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    court_type,
    pfs_offer,
    ocs_service_email,
    ocs_direct_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE pfs_to_defendant SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 PFS to Defendant status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing PFS to Defendant:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/pfs-to-defendant-email';
  console.log('▶️  Submitting PFS to Defendant to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email, // Map to n8n field name
      paralegal_email: paralegal_assignment_email, // Map to n8n field name
      court_type,
      pfs_offer,
      ocs_service_email,
      ocs_direct_email,
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ PFS to Defendant UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ PFS to Defendant UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit PFS to Defendant to UiPath', details: err.message });
  }
});
// ==============================
// Trial Letter to Client (trial_letter_to_client) CRUD & UiPath queue
// ==============================

// Fetch Trial Letter to Client data
router.get('/trial_letter_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Trial Letter to Client called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Trial Letter to Client called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM trial_letter_to_client
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Trial Letter to Client query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected Trial Letter to Client record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Trial Letter to Client data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Trial Letter to Client data
router.post('/trial_letter_to_client', async (req, res) => {
  console.log('📥 POST /automations/trial_letter_to_client body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Trial Letter to Client upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO trial_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs          = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ Trial Letter to Client upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'Trial Letter to Client saved' });
  } catch (err) {
    console.error('❌  Trial Letter to Client upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias route for n8n to call: /automations/Trial-Letter-to-Client (receives data from n8n workflow)
// Handle both uppercase and lowercase versions for compatibility
router.post('/Trial-Letter-to-Client', async (req, res) => {
  console.log('📥 POST /automations/Trial-Letter-to-Client body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Trial Letter to Client upsert uid (via Trial-Letter-to-Client alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO trial_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs          = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ Trial Letter to Client upsert successful for caseId', caseId, '(via Trial-Letter-to-Client alias)');
    return res.json({ success: true, message: 'Trial Letter to Client saved' });
  } catch (err) {
    console.error('❌  Trial Letter to Client upsert error (via Trial-Letter-to-Client alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Also register lowercase version for compatibility
router.post('/trial-letter-to-client', async (req, res) => {
  console.log('📥 POST /automations/trial-letter-to-client body (lowercase alias):', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Trial Letter to Client upsert uid (via trial-letter-to-client alias):', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  // 🔹 Accept both n8n field names (attorneys_email, paralegal_email) and database field names
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  // 🔹 Accept status from n8n, default to 'pending' for backward compatibility
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO trial_letter_to_client (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs          = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ Trial Letter to Client upsert successful for caseId', caseId, '(via trial-letter-to-client alias)');
    return res.json({ success: true, message: 'Trial Letter to Client saved' });
  } catch (err) {
    console.error('❌  Trial Letter to Client upsert error (via trial-letter-to-client alias):', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Trial Letter to Client status
const updateTrialLetterToClientStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE trial_letter_to_client SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 Trial Letter to Client status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'Trial Letter to Client status updated' });
  } catch (err) {
    console.error('❌  Update Trial Letter to Client status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/trial_letter_to_client', updateTrialLetterToClientStatus);
// Also handle hyphenated versions for n8n compatibility (note: POST routes for upsert are already registered above)
router.put('/Trial-Letter-to-Client', updateTrialLetterToClientStatus);
router.put('/trial-letter-to-client', updateTrialLetterToClientStatus);

// Delete Trial Letter to Client entries
router.delete('/trial_letter_to_client', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM trial_letter_to_client WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Trial Letter to Client entries deleted' });
  } catch (err) {
    console.error('❌  Delete Trial Letter to Client entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Trial Letter to Client via n8n (with caseId and documents)
router.post('/trial_letter_to_client/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 Trial Letter to Client /trial_letter_to_client/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log Trial Letter to Client trigger caller info:', logErr.message);
  }

  // Normalize caseId - accept both caseId and case_id from request
  const caseId = req.body.caseId ?? req.body.case_id;
  const documents = req.body.documents ?? [];
  const uid = req.body.uid;
  
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Use hardcoded URL as specified by user
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/Trial-Letter-to-Client';
  console.log('▶️  Triggering Trial Letter to Client webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Create or update record - set status to pending first (like response_to_mdt)
    try {
      await db.promisePool.execute(
        `INSERT INTO trial_letter_to_client (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 Trial Letter to Client status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    // Send caseId and documents to webhook (always use caseId, not case_id)
    const payload = {
      caseId,
      documents: documents || []
    };
    
    const response = await axios.post(n8nUrl, payload);
    console.log('✅  Trial Letter to Client automation triggered:', response.status, response.data);
    
    // Note: n8n workflow will update status when complete
    // Status remains 'pending' until n8n workflow completes
    
    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;
    
    // Check for specific n8n webhook configuration error
    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  Trial Letter to Client trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to trigger Trial Letter to Client automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }
    
    console.error('❌  Trial Letter to Client trigger error:', errorData || err.message);
    
    // Update status to failed on error
    try {
      await db.promisePool.execute(
        'UPDATE trial_letter_to_client SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }
    
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Trial Letter to Client automation', details: err.message });
  }
});

// Re-run Trial Letter to Client
router.post('/trial_letter_to_client/rerun', async (req, res) => {
  // Normalize caseId - accept both caseId and case_id from request
  const caseId = req.body.caseId ?? req.body.case_id;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM trial_letter_to_client WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Trial Letter to Client entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/trial_letter_to_client';
    console.log('▶️ Re-triggering Trial Letter to Client webhook:', n8nUrl, 'with caseId:', caseId);
    // Always send caseId (not case_id) to n8n
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Trial Letter to Client automation triggered:', response.status);

    return res.json({ success: true, message: 'Trial Letter to Client re-run triggered' });
  } catch (err) {
    console.error('❌  Trial Letter to Client re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit Trial Letter to Client to UiPath via n8n webhook
router.post('/trial_letter_to_client/queue', async (req, res) => {
  // Normalize caseId - accept both caseId and case_id from request
  const caseId = req.body.caseId ?? req.body.case_id;
  const {
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE trial_letter_to_client SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 Trial Letter to Client status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing Trial Letter to Client:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/Trial-Letter-to-Client-Email';
  console.log('▶️  Submitting Trial Letter to Client to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    // Always send caseId (not case_id) to n8n
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email, // Map to n8n field name
      paralegal_email: paralegal_assignment_email, // Map to n8n field name
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ Trial Letter to Client UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Trial Letter to Client UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit Trial Letter to Client to UiPath', details: err.message });
  }
});


// ==============================
// Turndown Letter (Employment) (employment_turndown) CRUD & UiPath queue
// ==============================

// Fetch Employment Turndown data
router.get('/employment_turndown', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Employment Turndown called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Employment Turndown called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         plaintiff,
         client_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM employment_turndown
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Employment Turndown query returned rows:', rows);
    const record =
      rows.find(r => String(r.status).toLowerCase() === 'pending') ||
      (rows.length ? rows[0] : null);
    console.log('🔍 Selected Employment Turndown record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Employment Turndown data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Employment Turndown data
router.post('/employment_turndown', async (req, res) => {
  console.log('📥 POST /automations/employment_turndown body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Employment Turndown upsert uid:', uid);

  const caseId       = req.body.caseId ?? req.body.case_id;
  const plaintiff    = req.body.plaintiff ?? null;
  const client_email = req.body.client_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO employment_turndown (
         case_id,
         uid,
         plaintiff,
         client_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid          = VALUES(uid),
         plaintiff    = VALUES(plaintiff),
         client_email = VALUES(client_email),
         updated_at   = NOW()
      `,
      [
        caseId,
        uid,
        plaintiff,
        client_email,
      ]
    );

    return res.json({ success: true, message: 'Employment Turndown data saved' });
  } catch (err) {
    console.error('❌  Employment Turndown data save error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});
router.post('/turndown-letter-employment', async (req, res) => {
  console.log('📥 POST /automations/turndown-letter-employment body:', req.body);
  
  const caseId       = req.body.caseId ?? req.body.case_id;
  // n8n sends 'name' instead of 'plaintiff' and 'email' instead of 'client_email'
  const plaintiff    = req.body.client_name ?? req.body.plaintiff ?? null;
  const client_email = req.body.email ?? req.body.client_email ?? null;

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO employment_turndown (
         case_id,
         plaintiff,
         client_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, 'pending', NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         plaintiff    = VALUES(plaintiff),
         client_email = VALUES(client_email),
         updated_at   = NOW()
      `,
      [
        caseId,
        plaintiff,
        client_email,
      ]
    );

    return res.json({ success: true, message: 'Employment Turndown data saved from n8n' });
  } catch (err) {
    console.error('❌  Employment Turndown data save error from n8n:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint for n8n webhook to PUT to (updates status after workflow completion)
router.put('/turndown-letter-employment', async (req, res) => {
  console.log('📥 PUT /automations/turndown-letter-employment body:', req.body);
  
  const caseId = req.body.caseId ?? req.body.case_id;
  let raw = (req.body.status ?? '').toString().trim().toLowerCase();

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Map status values
  const MAP = { complete: 'completed', in_progress: 'loading' };
  const status = MAP[raw] ?? raw;
  const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
  
  if (!status || !ALLOWED.has(status)) {
    return res.status(400).json({ 
      success: false, 
      message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` 
    });
  }

  try {
    const [result] = await db.promisePool.execute(
      'UPDATE employment_turndown SET status = ?, updated_at = NOW() WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated Employment Turndown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Employment Turndown status updated', status });
  } catch (err) {
    console.error('❌  Update Employment Turndown status error from n8n:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint for n8n webhook to PUT status to (updates status after workflow completion)
router.put('/turndown-letter-employment/status', async (req, res) => {
  console.log('📥 PUT /automations/turndown-letter-employment/status body:', req.body);
  
  const caseId = req.body.caseId ?? req.body.case_id;
  let raw = (req.body.status ?? '').toString().trim().toLowerCase();

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  // Map status values
  const MAP = { complete: 'completed', in_progress: 'loading' };
  const status = MAP[raw] ?? raw;
  const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
  
  if (!status || !ALLOWED.has(status)) {   
    return res.status(400).json({ 
      success: false, 
      message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` 
    });
  }

  try {
    const [result] = await db.promisePool.execute(
      'UPDATE employment_turndown SET status = ?, updated_at = NOW() WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    console.log('✅ Updated Employment Turndown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Employment Turndown status updated', status });
  } catch (err) {
    console.error('❌  Update Employment Turndown status error from n8n:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Employment Turndown status
router.put('/employment_turndown', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE employment_turndown SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Employment Turndown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Employment Turndown status updated', status });
  } catch (err) {
    console.error('❌  Update Employment Turndown status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Alias for Employment Turndown status update
router.put('/employment_turndown/status', async (req, res) => {
  try {
    const caseId = req.body.caseId ?? req.body.case_id ?? req.query.caseId ?? req.query.case_id ?? null;
    let raw = (req.body.status ?? req.query.status ?? '').toString().trim().toLowerCase();

    if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
    if (!raw)    return res.status(400).json({ success: false, message: 'Missing status' });

    const MAP = { complete: 'completed', in_progress: 'loading' };
    const status = MAP[raw] ?? raw;
    const ALLOWED = new Set(['pending', 'loading', 'completed', 'failed']);
    if (!ALLOWED.has(status)) {
      return res.status(400).json({ success: false, message: `Invalid status value: ${raw}. Allowed: ${[...ALLOWED].join(', ')}` });
    }

    const [result] = await db.promisePool.execute(
      'UPDATE employment_turndown SET status = ? WHERE case_id = ?',
      [status, caseId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Case not found' });

    console.log('✅ Updated Employment Turndown status for caseId', caseId, 'to', status);
    return res.json({ success: true, message: 'Employment Turndown status updated', status });
  } catch (err) {
    console.error('❌  Update Employment Turndown status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Employment Turndown entries
router.delete('/employment_turndown', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM employment_turndown WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Employment Turndown entries deleted' });
  } catch (err) {
    console.error('❌  Delete Employment Turndown entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/employment_turndown/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM employment_turndown WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Employment Turndown entries deleted' });
  } catch (err) {
    console.error('❌  Delete Employment Turndown entries by param error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Employment Turndown via n8n
router.post('/employment_turndown/trigger', async (req, res) => {
  // --- Caller audit for Employment Turndown trigger ---
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 Employment Turndown /employment_turndown/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log Employment Turndown trigger caller info:', logErr.message);
  }

  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/turn-down-employment';
  console.log('▶️  Triggering Employment Turndown webhook:', n8nUrl, 'with caseId:', caseId);

  try {
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Employment Turndown automation triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌  Employment Turndown trigger error:', err.response?.data || err.message);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Employment Turndown automation', details: err.message });
  }
});

// Re-run Employment Turndown: clear existing and trigger again via n8n
router.post('/employment_turndown/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    // Delete any existing Employment Turndown entries for this case
    await db.promisePool.execute('DELETE FROM employment_turndown WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Employment Turndown entries for caseId', caseId);

    // Trigger n8n webhook
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/turn-down-employment';
    console.log('▶️ Re-triggering Employment Turndown webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Employment Turndown automation triggered:', response.status);

    return res.json({ success: true, message: 'Employment Turndown re-run triggered' });
  } catch (err) {
    console.error('❌  Employment Turndown re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Enqueue Employment Turndown in UiPath Orchestrator
router.post('/employment_turndown/queue', async (req, res) => {
  const {
    caseId,
    uid,
    plaintiff,
    client_email,
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  // mark loading + store uipath_uid for trace
  try {
    await db.promisePool.execute(
      'UPDATE employment_turndown SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 Employment Turndown status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing Employment Turndown:', e.message);
  }

  try {
    const n8nUrl = 'https://n8n.louislawgroup.com/webhook/turn-down-employment-email';
    console.log('▶️  Submitting Employment Turndown to n8n webhook:', n8nUrl, 'with caseId:', caseId);

    const payload = {
      caseId,
      plaintiff,
      client_email,
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  Employment Turndown submitted to n8n:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Employment Turndown submit to n8n error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit Employment Turndown to n8n', details: err.message });
  }
});


// ==============================
// Wriretapping Notice Letter (wriretapping_notice_letter) CRUD & UiPath queue
// ==============================

// Fetch Wriretapping Notice Letter data
router.get('/wriretapping_notice_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) {
    console.log('🔍 Fetch Wriretapping Notice Letter called with caseId:', caseId);
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  console.log('🔍 Fetch Wriretapping Notice Letter called with caseId:', caseId);
  try {
    const [rows] = await db.promisePool.execute(
      `SELECT
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         to_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         uid,
         uipath_uid,
         status,
         created_at,
         updated_at
       FROM wriretapping_notice_letter
       WHERE case_id = ?`,
      [caseId]
    );
    console.log('🔍 Wriretapping Notice Letter query returned rows:', rows);
    const record = rows.find(r => String(r.status).toLowerCase() === 'pending') || (rows.length ? rows[0] : null);
    console.log('🔍 Selected Wriretapping Notice Letter record to return:', record);
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('❌  Fetch Wriretapping Notice Letter data error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Upsert Wriretapping Notice Letter data
router.post('/wriretapping_notice_letter', async (req, res) => {
  console.log('📥 POST /automations/wriretapping_notice_letter body:', req.body);
  const uid =
    (req.body.uid ?? req.headers['x-user-uid']) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  console.log('🆔 Wriretapping Notice Letter upsert uid:', uid);

  const caseId = req.body.caseId ?? req.body.case_id;
  const case_name = req.body.case_name ?? null;
  const case_number = req.body.case_number ?? null;
  const claim_number = req.body.claim_number ?? null;
  const policy_number = req.body.policy_number ?? null;
  const premises = req.body.premises ?? null;
  const date_of_loss = req.body.date_of_loss ?? null;
  const address = req.body.address ?? null;
  const type_of_loss = req.body.type_of_loss ?? null;
  const client_email = req.body.client_email ?? null;
  const to_email = req.body.to_email ?? null;
  const client_name = req.body.client_name ?? null;
  const indemnity_settlement = req.body.indemnity_settlement ?? null;
  const less_outstanding_costs = req.body.less_outstanding_costs ?? null;
  const total_disbursement = req.body.total_disbursement ?? null;
  const attorney_fees_and_court_costs = req.body.attorney_fees_and_court_costs ?? null;
  const senders_email = req.body.senders_email ?? null;
  const assigned_attorney_email = req.body.attorneys_email ?? req.body.assigned_attorney_email ?? null;
  const paralegal_assignment_email = req.body.paralegal_email ?? req.body.paralegal_assignment_email ?? null;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `INSERT INTO wriretapping_notice_letter (
         case_id,
         uid,
         case_name,
         case_number,
         claim_number,
         policy_number,
         premises,
         date_of_loss,
         address,
         type_of_loss,
         client_email,
         to_email,
         client_name,
         indemnity_settlement,
         less_outstanding_costs,
         total_disbursement,
         attorney_fees_and_court_costs,
         senders_email,
         assigned_attorney_email,
         paralegal_assignment_email,
         status,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
       )
       ON DUPLICATE KEY UPDATE
         uid                              = VALUES(uid),
         case_name                        = VALUES(case_name),
         case_number                      = VALUES(case_number),
         claim_number                     = VALUES(claim_number),
         policy_number                    = VALUES(policy_number),
         premises                         = VALUES(premises),
         date_of_loss                     = VALUES(date_of_loss),
         address                          = VALUES(address),
         type_of_loss                     = VALUES(type_of_loss),
         client_email                     = VALUES(client_email),
         to_email                         = VALUES(to_email),
         client_name                      = VALUES(client_name),
         indemnity_settlement             = VALUES(indemnity_settlement),
         less_outstanding_costs           = VALUES(less_outstanding_costs),
         total_disbursement               = VALUES(total_disbursement),
         attorney_fees_and_court_costs    = VALUES(attorney_fees_and_court_costs),
         senders_email                    = VALUES(senders_email),
         assigned_attorney_email         = VALUES(assigned_attorney_email),
         paralegal_assignment_email      = VALUES(paralegal_assignment_email),
         status                           = VALUES(status),
         updated_at                       = NOW()`,
      [
        caseId,
        uid,
        case_name,
        case_number,
        claim_number,
        policy_number,
        premises,
        date_of_loss,
        address,
        type_of_loss,
        client_email,
        to_email,
        client_name,
        indemnity_settlement,
        less_outstanding_costs,
        total_disbursement,
        attorney_fees_and_court_costs,
        senders_email,
        assigned_attorney_email,
        paralegal_assignment_email,
        status
      ]
    );
    console.log('✅ Wriretapping Notice Letter upsert successful for caseId', caseId);
    return res.json({ success: true, message: 'Wriretapping Notice Letter saved' });
  } catch (err) {
    console.error('❌  Wriretapping Notice Letter upsert error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Update Wriretapping Notice Letter status
const updateWriretappingNoticeLetterStatus = async (req, res) => {
  const caseId = req.body.caseId ?? req.body.case_id;
  const status = req.body.status ?? 'pending';

  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute(
      `UPDATE wriretapping_notice_letter SET status = ?, updated_at = NOW() WHERE case_id = ?`,
      [status, caseId]
    );
    console.log('💾 Wriretapping Notice Letter status updated for caseId:', caseId, 'to', status);
    return res.json({ success: true, message: 'Wriretapping Notice Letter status updated' });
  } catch (err) {
    console.error('❌  Update Wriretapping Notice Letter status error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

router.put('/wriretapping_notice_letter', updateWriretappingNoticeLetterStatus);

// Delete Wriretapping Notice Letter entries
router.delete('/wriretapping_notice_letter', async (req, res) => {
  const caseId = req.query.caseId ?? req.query.case_id;
  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });
  try {
    await db.promisePool.execute('DELETE FROM wriretapping_notice_letter WHERE case_id = ?', [caseId]);
    return res.status(200).json({ success: true, message: 'Wriretapping Notice Letter entries deleted' });
  } catch (err) {
    console.error('❌  Delete Wriretapping Notice Letter entries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Wriretapping Notice Letter via n8n (with caseId and documents)
router.post('/wriretapping_notice_letter/trigger', async (req, res) => {
  try {
    const callerIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    const ua = req.headers['user-agent'];
    console.log('📥 Wriretapping Notice Letter /wriretapping_notice_letter/trigger invoked', {
      ip: callerIp,
      ua,
      path: req.originalUrl,
      method: req.method,
      hasApiKey: Boolean(req.headers['x-api-key']),
      xForwardedFor: req.headers['x-forwarded-for'],
      body: req.body,
    });
  } catch (logErr) {
    console.warn('⚠️ Failed to log Wriretapping Notice Letter trigger caller info:', logErr.message);
  }

  const { caseId, documents = [], uid } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }
  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/wriretapping-notice-letter';
  console.log('▶️  Triggering Wriretapping Notice Letter webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    try {
      await db.promisePool.execute(
        `INSERT INTO wriretapping_notice_letter (case_id, uid, status, created_at, updated_at)
         VALUES (?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           uid = VALUES(uid),
           updated_at = NOW()`,
        [caseId, uid || null]
      );
      console.log('💾 Wriretapping Notice Letter status set to pending for caseId', caseId);
    } catch (e) {
      console.warn('⚠️ Failed to set pending status before trigger:', e.message);
    }

    const payload = {
      caseId,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅  Wriretapping Notice Letter automation triggered:', response.status, response.data);

    return res.json({ success: true, data: response.data });
  } catch (err) {
    const errorData = err.response?.data;
    const statusCode = err.response?.status;

    if (statusCode === 404 && errorData && typeof errorData === 'object' && errorData.message) {
      const errorMessage = errorData.message.toLowerCase();
      if (errorMessage.includes('not registered for post') || errorMessage.includes('did you mean to make a get request')) {
        console.error('❌  Wriretapping Notice Letter trigger error: Webhook not configured for POST requests in n8n');
        return res.status(500).json({
          success: false,
          message: 'Failed to trigger Wriretapping Notice Letter automation: Webhook configuration issue',
          details: 'The n8n webhook is not configured to accept POST requests. Please update the webhook in n8n to accept POST requests, or check if the webhook URL is correct.',
          n8nError: errorData.message
        });
      }
    }

    console.error('❌  Wriretapping Notice Letter trigger error:', errorData || err.message);

    try {
      await db.promisePool.execute(
        'UPDATE wriretapping_notice_letter SET status = ?, updated_at = NOW() WHERE case_id = ?',
        ['failed', caseId]
      );
    } catch (e) {
      console.warn('⚠️ Failed to set failed status:', e.message);
    }

    return res
      .status(500)
      .json({ success: false, message: 'Failed to trigger Wriretapping Notice Letter automation', details: err.message });
  }
});

// Re-run Wriretapping Notice Letter
router.post('/wriretapping_notice_letter/rerun', async (req, res) => {
  const { caseId } = req.body;
  if (!caseId) {
    return res.status(400).json({ success: false, message: 'Missing caseId' });
  }

  try {
    await db.promisePool.execute('DELETE FROM wriretapping_notice_letter WHERE case_id = ?', [caseId]);
    console.log('🗑️ Deleted existing Wriretapping Notice Letter entries for caseId', caseId);

    const n8nUrl = 'https://dev.louislawgroup.com/automations/wriretapping_notice_letter';
    console.log('▶️ Re-triggering Wriretapping Notice Letter webhook:', n8nUrl, 'with caseId:', caseId);
    const response = await axios.post(n8nUrl, { caseId });
    console.log('✅  Re-run Wriretapping Notice Letter automation triggered:', response.status);

    return res.json({ success: true, message: 'Wriretapping Notice Letter re-run triggered' });
  } catch (err) {
    console.error('❌  Wriretapping Notice Letter re-run error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Submit Wriretapping Notice Letter to UiPath via n8n webhook
router.post('/wriretapping_notice_letter/queue', async (req, res) => {
  const {
    caseId,
    uid,
    case_name,
    case_number,
    claim_number,
    policy_number,
    premises,
    date_of_loss,
    address,
    type_of_loss,
    client_email,
    to_email,
    client_name,
    indemnity_settlement,
    less_outstanding_costs,
    total_disbursement,
    attorney_fees_and_court_costs,
    senders_email,
    assigned_attorney_email,
    paralegal_assignment_email,
    documents = []
  } = req.body;

  if (!caseId) return res.status(400).json({ success: false, message: 'Missing caseId' });

  try {
    await db.promisePool.execute(
      'UPDATE wriretapping_notice_letter SET status = ?, uipath_uid = ?, updated_at = NOW() WHERE case_id = ?',
      ['loading', uid ?? null, caseId]
    );
    console.log('💾 Wriretapping Notice Letter status set to loading for caseId', caseId, 'by user', uid);
  } catch (e) {
    console.warn('⚠️ Failed to set loading status before queueing Wriretapping Notice Letter:', e.message);
  }

  const n8nUrl = 'https://n8n.louislawgroup.com/webhook/wriretapping-notice-letter-email';
  console.log('▶️  Submitting Wriretapping Notice Letter to UiPath via n8n webhook:', n8nUrl, 'with caseId:', caseId, 'and', documents.length, 'documents');

  try {
    const payload = {
      caseId,
      case_name,
      case_number,
      claim_number,
      policy_number,
      premises,
      date_of_loss,
      address,
      type_of_loss,
      client_email,
      to_email,
      client_name,
      indemnity_settlement,
      less_outstanding_costs,
      total_disbursement,
      attorney_fees_and_court_costs,
      senders_email,
      attorneys_email: assigned_attorney_email,
      paralegal_email: paralegal_assignment_email,
      uid,
      documents: documents || []
    };

    const response = await axios.post(n8nUrl, payload);
    console.log('✅ Wriretapping Notice Letter UiPath submission triggered:', response.status, response.data);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('❌ Wriretapping Notice Letter UiPath submission error for caseId', caseId, ':', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit Wriretapping Notice Letter to UiPath', details: err.message });
  }
});

module.exports = router;
