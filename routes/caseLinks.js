// routes/caseLinks.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * PUT /cases/:caseId/owner
 * Body: { owner_client_id: number | null }
 * - Sets cases.contact_id to the provided client id (or null to clear)
 * - Validates that case and client exist
 * - Uses a transaction for safety
 */
router.put("/cases/:caseId/owner", (req, res) => {
  const caseId = Number(req.params.caseId);
  const ownerClientId =
    req.body.owner_client_id === null ? null : Number(req.body.owner_client_id);

  if (!Number.isInteger(caseId)) {
    return res.status(400).json({ error: "Invalid caseId." });
  }
  if (ownerClientId !== null && !Number.isInteger(ownerClientId)) {
    return res.status(400).json({ error: "owner_client_id must be an integer or null." });
  }

  db.beginTransaction((txErr) => {
    if (txErr) {
      console.error("beginTransaction error:", txErr);
      return res.status(500).send("Transaction start failed.");
    }

    // 1) Ensure case exists
    db.query("SELECT case_id FROM cases WHERE case_id = ? LIMIT 1", [caseId], (e1, r1) => {
      if (e1) {
        db.rollback(() => {});
        console.error("Check case error:", e1);
        return res.status(500).send("Error checking case.");
      }
      if (!r1.length) {
        db.rollback(() => {});
        return res.status(404).json({ error: "Case not found." });
      }

      const proceed = () => {
        // 3) Update owner
        db.query(
          "UPDATE cases SET contact_id = ? WHERE case_id = ?",
          [ownerClientId, caseId],
          (e3) => {
            if (e3) {
              db.rollback(() => {});
              console.error("Update owner error:", e3);
              return res.status(500).send("Failed to update case owner.");
            }
            db.commit((cErr) => {
              if (cErr) {
                db.rollback(() => {});
                console.error("Commit error:", cErr);
                return res.status(500).send("Commit failed.");
              }
              return res.json({
                message:
                  ownerClientId === null
                    ? "Case owner cleared."
                    : "Case owner set successfully.",
                case_id: caseId,
                owner_client_id: ownerClientId,
              });
            });
          }
        );
      };

      // 2) If owner is null, skip client check
      if (ownerClientId === null) return proceed();

      // 2a) Ensure client exists
      db.query("SELECT id FROM client WHERE id = ? LIMIT 1", [ownerClientId], (e2, r2) => {
        if (e2) {
          db.rollback(() => {});
          console.error("Check client error:", e2);
          return res.status(500).send("Error checking client.");
        }
        if (!r2.length) {
          db.rollback(() => {});
          return res.status(404).json({ error: "Owner client not found." });
        }
        proceed();
      });
    });
  });
});

/**
 * DELETE /cases/:caseId/owner
 * - Clears the owner (sets contact_id = NULL)
 */
router.delete("/cases/:caseId/owner", (req, res) => {
  const caseId = Number(req.params.caseId);
  if (!Number.isInteger(caseId)) {
    return res.status(400).json({ error: "Invalid caseId." });
  }
  db.query("UPDATE cases SET contact_id = NULL WHERE case_id = ?", [caseId], (err, r) => {
    if (err) {
      console.error("Clear owner error:", err);
      return res.status(500).send("Failed to clear case owner.");
    }
    if (!r.affectedRows) return res.status(404).json({ error: "Case not found." });
    return res.json({ message: "Case owner cleared.", case_id: caseId });
  });
});

/**
 * PUT /clients/:clientId/cases
 * Body: { case_ids: number[] }  (full replacement)
 * - Replaces all client_case links for this client with the provided array
 * - Validates that client exists and that provided cases exist
 * - Runs in a transaction and is idempotent
 */
router.put("/clients/:clientId/cases", (req, res) => {
  const clientId = Number(req.params.clientId);

  // Robust parsing (accepts [456], ["456"], "456,789")
  const raw = req.body?.case_ids;
  let parsed;
  if (Array.isArray(raw)) parsed = raw;
  else if (typeof raw === "string") parsed = raw.split(",").map(s => s.trim()).filter(Boolean);
  else if (raw === undefined) return res.status(400).json({ error: "Missing case_ids in body." });
  else return res.status(400).json({ error: "case_ids must be an array or a comma-separated string." });

  const caseIds = Array.from(
    new Set(
      parsed.map(v => Number(String(v).trim())).filter(Number.isFinite).map(v => Math.trunc(v))
    )
  );

  if (!Number.isInteger(clientId)) return res.status(400).json({ error: "Invalid clientId." });

  // ⬇️ Use a single connection from the pool
  db.getConnection((connErr, conn) => {
    if (connErr) {
      console.error("getConnection error:", connErr);
      return res.status(500).send("Failed to get DB connection.");
    }

    const safeRelease = () => { try { conn.release(); } catch (_) {} };

    conn.beginTransaction((txErr) => {
      if (txErr) {
        console.error("beginTransaction error:", txErr);
        safeRelease();
        return res.status(500).send("Transaction start failed.");
      }

      // 1) Validate client
      conn.query("SELECT id FROM client WHERE id = ? LIMIT 1", [clientId], (e1, r1) => {
        if (e1) {
          conn.rollback(() => { safeRelease(); });
          console.error("Check client error:", e1);
          return res.status(500).send("Error checking client.");
        }
        if (!r1.length) {
          conn.rollback(() => { safeRelease(); });
          return res.status(404).json({ error: "Client not found." });
        }

        // 2) Validate cases
        const validateCases = (next) => {
          if (caseIds.length === 0) return next(); // allow unlink all
          conn.query(
            `SELECT case_id FROM cases WHERE case_id IN (${caseIds.map(() => "?").join(",")})`,
            caseIds,
            (e2, r2) => {
              if (e2) return next(e2);
              const found = new Set(r2.map(row => row.case_id));
              const missing = caseIds.filter(id => !found.has(id));
              if (missing.length) {
                const err = new Error(`These case_ids do not exist: ${missing.join(", ")}`);
                err.status = 400;
                return next(err);
              }
              next();
            }
          );
        };

        validateCases((valErr) => {
          if (valErr) {
            conn.rollback(() => { safeRelease(); });
            if (valErr.status) {
              return res.status(valErr.status).json({ error: valErr.message });
            }
            console.error("Validation error:", valErr);
            return res.status(500).send("Validation failed.");
          }

          // 3) Replace links
          conn.query("DELETE FROM client_case WHERE client_id = ?", [clientId], (e3) => {
            if (e3) {
              conn.rollback(() => { safeRelease(); });
              console.error("Delete links error:", e3);
              return res.status(500).send("Failed to clear existing links.");
            }

            if (caseIds.length === 0) {
              return conn.commit((cErr) => {
                if (cErr) {
                  conn.rollback(() => { safeRelease(); });
                  console.error("Commit error:", cErr);
                  return res.status(500).send("Commit failed.");
                }
                safeRelease();
                return res.json({ message: "Links replaced.", client_id: clientId, case_ids: [] });
              });
            }

            const values = caseIds.map(cid => [clientId, cid]);
            conn.query("INSERT INTO client_case (client_id, case_id) VALUES ?", [values], (e4) => {
              if (e4) {
                conn.rollback(() => { safeRelease(); });
                console.error("Insert links error:", e4);
                return res.status(500).send("Failed to insert new links.");
              }
              conn.commit((cErr) => {
                if (cErr) {
                  conn.rollback(() => { safeRelease(); });
                  console.error("Commit error:", cErr);
                  return res.status(500).send("Commit failed.");
                }
                safeRelease();
                return res.json({ message: "Links replaced.", client_id: clientId, case_ids: caseIds });
              });
            });
          });
        });
      });
    });
  });
});

module.exports = router;