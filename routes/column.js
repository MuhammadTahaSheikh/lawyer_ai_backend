// routes/caseStages.js
const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/columns", (req, res) => {
    const parentType = req.query.parent_type;
    if (!parentType) {
      return res.status(400).json({ error: "parent_type is required" });
    }
  
    const tableName = `${parentType}s`;
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid parent_type" });
    }

    const tableColumnsQuery = `
      SELECT column_name AS "Field"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?
      ORDER BY ordinal_position
    `;
    const customFieldsQuery = `
      SELECT cf.*, 
             lo.list_options_id, 
             lo.option_key, 
             lo.option_value, 
             lo.created_at AS option_created_at, 
             lo.updated_at AS option_updated_at,
             cpa.practice_area_id
      FROM custom_fields cf
      LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
      LEFT JOIN custom_field_practice_areas cpa ON cf.custom_fields_id = cpa.custom_field_id_f

      WHERE cf.parent_type = ?
    `;
  
    db.query(tableColumnsQuery, [tableName], (err, tableResults) => {
      if (err) {
                 // If table doesn't exist yet, query without practice areas join
          if (
            (err.code === 'ER_NO_SUCH_TABLE' || err.code === '42P01') &&
            err.sqlMessage && err.sqlMessage.includes('custom_field_practice_areas')
          ) {
            const fallbackQuery = `
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
            return db.query(fallbackQuery, [parentType], (fallbackErr, fallbackResults) => {
              if (fallbackErr) {
                console.error("Error fetching custom fields:", fallbackErr);
                return res
                  .status(500)
                  .json({ error: "Error fetching custom fields.", details: fallbackErr });
              }
              // Process results without practice areas
              const customFieldsMap = new Map();
              fallbackResults.forEach((row) => {
                if (!customFieldsMap.has(row.custom_fields_id)) {
                  customFieldsMap.set(row.custom_fields_id, {
                    custom_fields_id: row.custom_fields_id,
                    custom_fields_name: row.custom_fields_name,
                    parent_type: row.parent_type,
                    field_type: row.field_type,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    list_options: [],
                    practice_areas: [],
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
              const tableColumns = tableResults.map((row) => row.Field || row.field);
              return res.json({
                table_columns: tableColumns,
                custom_fields: customFields,
              });
            });
          }
        console.error("Error fetching table columns:", err);
        return res
          .status(500)
          .json({ error: "Error fetching table columns.", details: err });
      }
  
      db.query(customFieldsQuery, [parentType], (err, customFieldsResults) => {
        if (err) {
          console.error("Error fetching custom fields:", err);
          return res
            .status(500)
            .json({ error: "Error fetching custom fields.", details: err });
        }
  
        const tableColumns = tableResults.map((row) => row.Field || row.field);
  
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
                practice_areas: [],
              _seen_list_options: new Set(), // Track seen list option IDs to avoid duplicates
            });
          }
  
          // if (row.field_type === "list" && row.list_options_id) {

          // Add list option only if not already added (avoid duplicates from JOIN)
          if (row.field_type === "list" && row.list_options_id && 
              !customFieldsMap.get(row.custom_fields_id)._seen_list_options.has(row.list_options_id)) {
            customFieldsMap.get(row.custom_fields_id)._seen_list_options.add(row.list_options_id);
            customFieldsMap.get(row.custom_fields_id).list_options.push({
              list_options_id: row.list_options_id,
              option_key: row.option_key,
              option_value: row.option_value,
              created_at: row.option_created_at,
              updated_at: row.option_updated_at,
            });
          }
           // Collect practice area IDs
          if (row.practice_area_id && 
              !customFieldsMap.get(row.custom_fields_id).practice_areas.includes(row.practice_area_id)) {
            customFieldsMap.get(row.custom_fields_id).practice_areas.push(row.practice_area_id);
          }
        });

        // Clean up the tracking sets before returning
        customFieldsMap.forEach((field) => {
          delete field._seen_list_options;
        });
  
        const customFields = Array.from(customFieldsMap.values());
  
        res.json({
          table_columns: tableColumns,
          custom_fields: customFields,
        });
      });
    });
  });

module.exports = router;