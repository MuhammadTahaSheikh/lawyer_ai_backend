// // routes/customFields.js
// const express = require("express");
// const router = express.Router();
// const db = require("../db");
// const pool = db;

// // Map of allowed parent_type to actual table names
// const PARENT_TABLES = {
//   case: "cases",
//   // add other parent_type → tableName mappings as needed
// };

// // GET /custom_fields – fetch all custom fields (optionally filtered by parent_type)
// router.get("/custom_fields", (req, res) => {
//   const { parent_type } = req.query; // Get parent_type from query params

//   let query = `
//     SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
//     FROM custom_fields cf
//     LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
//   `;

//   // Add a WHERE clause if parent_type is provided
//   if (parent_type) {
//     query += ` WHERE cf.parent_type = ?`;
//   }

//   query += ` ORDER BY cf.created_at DESC`;

//   // Execute the query with or without parameter
//   db.query(query, parent_type ? [parent_type] : [], (err, results) => {
//     if (err) {
//       console.error("Error fetching custom fields:", err);
//       return res.status(500).send("Error fetching custom fields.");
//     }

//     let customFields = {};

//     results.forEach((row) => {
//       if (!customFields[row.custom_fields_id]) {
//         customFields[row.custom_fields_id] = {
//           custom_fields_id: row.custom_fields_id,
//           custom_fields_name: row.custom_fields_name,
//           parent_type: row.parent_type,
//           field_type: row.field_type,
//           created_at: row.created_at,
//           updated_at: row.updated_at,
//           list_options: [],
//         };
//       }

//       if (row.field_type === "list" && row.list_options_id) {
//         customFields[row.custom_fields_id].list_options.push({
//           list_options_id: row.list_options_id,
//           option_key: row.option_key,
//           option_value: row.option_value,
//           created_at: row.option_created_at,
//           updated_at: row.option_updated_at,
//         });
//       }
//     });

//     res.json(Object.values(customFields));
//   });
// });

// // GET /custom_fields/:id – fetch single custom field
// router.get("/custom_fields/:id", (req, res) => {
//   const id = req.params.id;
//   const query = `
//     SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
//     FROM custom_fields cf
//     LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
//     WHERE cf.custom_fields_id = ?
//   `;

//   db.query(query, [id], (err, results) => {
//     if (err) {
//       console.error("Error fetching custom field:", err);
//       return res.status(500).send("Error fetching custom field.");
//     }

//     if (results.length === 0) {
//       return res.status(404).send("Custom field not found.");
//     }

//     let customField = {
//       custom_fields_id: results[0].custom_fields_id,
//       custom_fields_name: results[0].custom_fields_name,
//       parent_type: results[0].parent_type,
//       field_type: results[0].field_type,
//       created_at: results[0].created_at,
//       updated_at: results[0].updated_at,
//       list_options: [],
//     };

//     results.forEach((row) => {
//       if (row.field_type === "list" && row.list_options_id) {
//         customField.list_options.push({
//           list_options_id: row.list_options_id,
//           option_key: row.option_key,
//           option_value: row.option_value,
//           created_at: row.option_created_at,
//           updated_at: row.option_updated_at,
//         });
//       }
//     });

//     res.json(customField);
//   });
// });

// // POST /custom_fields – create a new custom field (with list options if list type)
// // POST /custom_fields – create a new custom field with optional list options
// router.post("/custom_fields", (req, res) => {
//   let { custom_fields_name, parent_type, field_type, list_options } = req.body;
//   custom_fields_name = custom_fields_name?.trim().replace(/\s+/g, "_").toLowerCase();
//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   // Validate parent_type against whitelist
//   if (!PARENT_TABLES[parent_type]) {
//     return res.status(400).send("Invalid parent_type.");
//   }

//   pool.getConnection((err, conn) => {
//     if (err) {
//       console.error("DB connection error:", err);
//       return res.status(500).send("Database connection error.");
//     }

//     conn.beginTransaction(err => {
//       if (err) {
//         conn.release();
//         console.error("Transaction start error:", err);
//         return res.status(500).send("Transaction error.");
//       }

//       // 1) Duplicate check
//       const checkDup = "SELECT COUNT(*) AS count FROM custom_fields WHERE custom_fields_name = ?";
//       conn.query(checkDup, [custom_fields_name], (err, results) => {
//         if (err) {
//           return conn.rollback(() => {
//             conn.release();
//             console.error("Duplicate check error:", err);
//             return res.status(500).send("Error checking duplicate custom field.");
//           });
//         }
//         if (results[0].count > 0) {
//           conn.release();
//           return res.status(409).send("Custom field already exists.");
//         }

//         // 2) Insert base record
//         const insertSQL = 
//           "INSERT INTO custom_fields (custom_fields_name, parent_type, field_type, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())";
//         conn.query(insertSQL, [custom_fields_name, parent_type, field_type], (err, result) => {
//           if (err) {
//             return conn.rollback(() => {
//               conn.release();
//               console.error("Insert error:", err);
//               return res.status(500).send("Error adding custom field.");
//             });
//           }

//           const custom_fields_id = result.insertId;
//           const tableName = PARENT_TABLES[parent_type];

//           // 3) Build ALTER TABLE to add the new column
//           let alterTableSQL = "";
//           if (field_type === "long_text") {
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` LONGTEXT`;
//           } else if (field_type === "short_text") {
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` VARCHAR(255)`;
//           } else if (field_type === "number") {
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` INT`;
//           } else if (field_type === "currency") {
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` DECIMAL(10,2)`;
//           } else if (field_type === "date") {
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` DATE`;
//           } else if (field_type === "list" && Array.isArray(list_options) && list_options.length) {
//             const enumVals = list_options.map(o => `'${o.option_value}'`).join(",");
//             alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` ENUM(${enumVals})`;
//           }

//           conn.query(alterTableSQL, err => {
//             if (err) {
//               return conn.rollback(() => {
//                 conn.release();
//                 console.error(`Alter table error (${tableName}):`, err);
//                 return res.status(500).send(`Error modifying table ${tableName}: ${err.message}`);
//               });
//             }

//             // 4) If it's a list type, bulk‐insert list_options
//             if (field_type === "list" && Array.isArray(list_options) && list_options.length) {
//               const optsSQL = 
//                 "INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) VALUES ?";
//               const optsVals = list_options.map(o => [
//                 custom_fields_id,
//                 o.option_key,
//                 o.option_value,
//                 new Date(),
//                 new Date()
//               ]);
//               conn.query(optsSQL, [optsVals], err => {
//                 if (err) {
//                   return conn.rollback(() => {
//                     conn.release();
//                     console.error("List options insert error:", err);
//                     return res.status(500).send("Error adding list options.");
//                   });
//                 }
//                 // 5) commit transaction
//                 conn.commit(err => {
//                   conn.release();
//                   if (err) {
//                     console.error("Commit error:", err);
//                     return res.status(500).send("Error committing transaction.");
//                   }
//                   return res.status(201).json({
//                     custom_fields_id,
//                     custom_fields_name,
//                     parent_type,
//                     field_type,
//                     list_options
//                   });
//                 });
//               });
//             } else {
//               // No list options: just commit
//               conn.commit(err => {
//                 conn.release();
//                 if (err) {
//                   console.error("Commit error:", err);
//                   return res.status(500).send("Error committing transaction.");
//                 }
//                 return res.status(201).json({
//                   custom_fields_id,
//                   custom_fields_name,
//                   parent_type,
//                   field_type
//                 });
//               });
//             }
//           });
//         });
//       });
//     });
//   });
// });
// router.put("/custom_fields/:id/full_update", (req, res) => {
//   const id = req.params.id;
//   const { custom_fields_name, parent_type, field_type, list_options } =
//     req.body;

//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   // Check if new custom_fields_name already exists
//   const checkDuplicateQuery = `
//     SELECT COUNT(*) AS count FROM custom_fields 
//     WHERE custom_fields_name = ? AND custom_fields_id != ?`;

//   db.query(checkDuplicateQuery, [custom_fields_name, id], (err, results) => {
//     if (err) {
//       console.error("Error checking duplicate custom field:", err);
//       return res.status(500).send("Error checking duplicate custom field.");
//     }

//     if (results[0].count > 0) {
//       return res
//         .status(409)
//         .send("Custom field with the same name already exists.");
//     }

//     // Fetch the current custom field details
//     const fetchFieldQuery = `
//       SELECT custom_fields_name, parent_type, field_type 
//       FROM custom_fields WHERE custom_fields_id = ?`;

//     db.query(fetchFieldQuery, [id], (err, fieldResults) => {
//       if (err) {
//         console.error("Error fetching custom field:", err);
//         return res.status(500).send("Error fetching custom field.");
//       }

//       if (fieldResults.length === 0) {
//         return res.status(404).send("Custom field not found.");
//       }

//       const oldCustomFieldsName = fieldResults[0].custom_fields_name;
//       const oldParentType = fieldResults[0].parent_type;
//       const oldFieldType = fieldResults[0].field_type;
//       console.log("🔍 Renaming column:", {
//         tableName: PARENT_TABLES[oldParentType],
//         oldCustomFieldsName,
//         id,
//       });

//       // Update the custom field details
//       const updateFieldQuery = `
//         UPDATE custom_fields 
//         SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
//         WHERE custom_fields_id = ?`;

//       db.query(
//         updateFieldQuery,
//         [custom_fields_name, parent_type, field_type, id],
//         (err, result) => {
//           if (err) {
//             console.error("Error updating custom field:", err);
//             return res.status(500).send("Error updating custom field.");
//           }

//           const tableName = PARENT_TABLES[oldParentType];
//           // Slugify the old custom field name to match the actual column
//           const oldColumnName = oldCustomFieldsName.trim().replace(/\s+/g, "_").toLowerCase();

//           // Get the column type dynamically, scoped to the current database
//           const getColumnTypeQuery = `
//             SELECT COLUMN_TYPE
//             FROM INFORMATION_SCHEMA.COLUMNS
//             WHERE TABLE_SCHEMA = DATABASE()
//               AND TABLE_NAME   = ?
//               AND COLUMN_NAME  = ?
//           `;

//           db.query(
//             getColumnTypeQuery,
//             [tableName, oldColumnName],
//             (err, columnResult) => {
//               if (err) {
//                 console.error("Error fetching column type:", err);
//                 return res.status(500).send("Error fetching column type.");
//               }

//               if (columnResult.length === 0) {
//                 return res
//                   .status(404)
//                   .send("Column not found in the database.");
//               }

//               const columnType = columnResult[0].COLUMN_TYPE;

//               // Rename column while preserving its data type
//               const renameColumnQuery = `
//                 ALTER TABLE \`${tableName}\`
//                 CHANGE COLUMN \`${oldColumnName}\` \`${custom_fields_name}\` ${columnType}
//               `;

//               db.query(renameColumnQuery, (err) => {
//                 if (err) {
//                   console.error(`Error renaming column in ${tableName}:`, err);
//                   return res
//                     .status(500)
//                     .send(
//                       `Error renaming column in ${tableName}: ${err.message}`
//                     );
//                 }

//                 updateListOptions();
//               });
//             }
//           );

//           // Function to update list options and ENUM column
//           function updateListOptions() {
//             if (field_type === "list" && Array.isArray(list_options)) {
//               const fetchOptionsQuery = `SELECT list_options_id FROM list_options WHERE custom_field_id_f = ?`;

//               db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
//                 if (err) {
//                   console.error("Error fetching existing list options:", err);
//                   return res.status(500).send("Error fetching list options.");
//                 }

//                 const existingIds = existingOptions.map(
//                   (option) => option.list_options_id
//                 );
//                 const providedIds = list_options
//                   .map((option) => option.list_options_id)
//                   .filter((id) => id !== undefined);
//                 const providedIds2 = list_options
//                   .map((option) => option.option_value)
//                   .filter((id) => id !== undefined);

//                 // Determine which options to delete
//                 const idsToDelete = existingIds.filter(
//                   (existingId) => !providedIds.includes(existingId)
//                 );
//                 const idsToAdd = providedIds.filter(
//                   (newId) => !existingIds.includes(newId)
//                 );

//                 let updateQueries = [];

//                 // Delete removed list options
//                 if (idsToDelete.length > 0) {
//                   const deleteQuery = `DELETE FROM list_options WHERE list_options_id IN (?) AND custom_field_id_f = ?`;
//                   updateQueries.push(
//                     new Promise((resolve, reject) => {
//                       db.query(
//                         deleteQuery,
//                         [idsToDelete, id],
//                         (err, result) => {
//                           if (err) {
//                             console.error("Error deleting list options:", err);
//                             reject(err);
//                           } else {
//                             resolve(result);
//                           }
//                         }
//                       );
//                     })
//                   );
//                 }

//                 // Insert new list options
//                 list_options.forEach((option) => {
//                   if (!existingIds.includes(option.list_options_id)) {
//                     const insertQuery = `
//                     INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
//                     VALUES (?, ?, ?, NOW(), NOW())`;

//                     updateQueries.push(
//                       new Promise((resolve, reject) => {
//                         db.query(
//                           insertQuery,
//                           [id, option.option_key, option.option_value],
//                           (err, result) => {
//                             if (err) {
//                               console.error(
//                                 "Error inserting list option:",
//                                 err
//                               );
//                               reject(err);
//                             } else {
//                               resolve(result);
//                             }
//                           }
//                         );
//                       })
//                     );
//                   }
//                 });

//                 // Update ENUM column in cases table based on list_options_id
//                 const newEnumValues =
//                   providedIds2.length > 0
//                     ? providedIds2.map((id) => `'${id}'`).join(",")
//                     : "'N/A'";
//                 const alterEnumQuery = `
//                 ALTER TABLE \`${tableName}\` 
//                 MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

//                 updateQueries.push(
//                   new Promise((resolve, reject) => {
//                     db.query(alterEnumQuery, (err) => {
//                       if (err) {
//                         console.error(
//                           `Error modifying ENUM column in ${tableName}:`,
//                           err
//                         );
//                         reject(err);
//                       } else {
//                         resolve();
//                       }
//                     });
//                   })
//                 );

//                 Promise.all(updateQueries)
//                   .then(() => {
//                     res.send(
//                       "Custom field, list options, and ENUM column updated successfully."
//                     );
//                   })
//                   .catch((err) => {
//                     console.error("Error updating list options:", err);
//                     res.status(500).send("Error updating list options.");
//                   });
//               });
//             } else {
//               res.send("Custom field updated successfully.");
//             }
//           }
//         }
//       );
//     });
//   });
// });
// // PUT /custom_fields/:id – update custom field basic details (or full update endpoints can be similarly set up)
// router.put("/custom_fields/:id", (req, res) => {
//   const id = req.params.id;
//   const { custom_fields_name, parent_type, field_type } = req.body;

//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   const slugName = custom_fields_name.trim().replace(/\s+/g, "_").toLowerCase();

//   const updateQuery = `
//     UPDATE custom_fields 
//     SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
//     WHERE custom_fields_id = ?`;

//   db.query(
//     updateQuery,
//     [slugName, parent_type, field_type, id],
//     (err, result) => {
//       if (err) {
//         console.error("Error updating custom field:", err);
//         return res.status(500).send("Error updating custom field.");
//       }

//       if (result.affectedRows === 0) {
//         return res.status(404).send("Custom field not found.");
//       }

//       res.send("Custom field updated successfully.");
//     }
//   );
// });
// router.put("/custom_fields/:id/list_options", (req, res) => {
//   const { list_options } = req.body;

//   if (!Array.isArray(list_options) || list_options.length === 0) {
//     return res.status(400).send("List options are required.");
//   }

//   let updateQueries = list_options.map((option) => {
//     return new Promise((resolve, reject) => {
//       const updateQuery = `
//         UPDATE list_options 
//         SET option_key = ?, option_value = ?, updated_at = NOW() 
//         WHERE list_options_id = ?`;

//       db.query(
//         updateQuery,
//         [option.option_key, option.option_value, option.list_options_id],
//         (err, result) => {
//           if (err) reject(err);
//           else resolve(result);
//         }
//       );
//     });
//   });

//   Promise.all(updateQueries)
//     .then(() => {
//       res.send("List options updated successfully.");
//     })
//     .catch((err) => {
//       console.error("Error updating list options:", err);
//       res.status(500).send("Error updating list options.");
//     });
// });
// // PUT /custom_fields/:id/list_options – update only list options for a custom field
// router.put("/custom_fields/:id/full_update", (req, res) => {
//   const id = req.params.id;
//   const { custom_fields_name, parent_type, field_type, list_options } =
//     req.body;

//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   // Check if new custom_fields_name already exists
//   const checkDuplicateQuery = `
//     SELECT COUNT(*) AS count FROM custom_fields 
//     WHERE custom_fields_name = ? AND custom_fields_id != ?`;

//   db.query(checkDuplicateQuery, [custom_fields_name, id], (err, results) => {
//     if (err) {
//       console.error("Error checking duplicate custom field:", err);
//       return res.status(500).send("Error checking duplicate custom field.");
//     }

//     if (results[0].count > 0) {
//       return res
//         .status(409)
//         .send("Custom field with the same name already exists.");
//     }

//     // Fetch the current custom field details
//     const fetchFieldQuery = `
//       SELECT custom_fields_name, parent_type, field_type 
//       FROM custom_fields WHERE custom_fields_id = ?`;

//     db.query(fetchFieldQuery, [id], (err, fieldResults) => {
//       if (err) {
//         console.error("Error fetching custom field:", err);
//         return res.status(500).send("Error fetching custom field.");
//       }

//       if (fieldResults.length === 0) {
//         return res.status(404).send("Custom field not found.");
//       }

//       const oldCustomFieldsName = fieldResults[0].custom_fields_name;
//       const oldParentType = fieldResults[0].parent_type;
//       const oldFieldType = fieldResults[0].field_type;

//       // Update the custom field details
//       const updateFieldQuery = `
//         UPDATE custom_fields 
//         SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
//         WHERE custom_fields_id = ?`;

//       db.query(
//         updateFieldQuery,
//         [custom_fields_name, parent_type, field_type, id],
//         (err, result) => {
//           if (err) {
//             console.error("Error updating custom field:", err);
//             return res.status(500).send("Error updating custom field.");
//           }

//           let tableName = oldParentType === "case" ? "cases" : oldParentType;

//           // Get the column type dynamically
//           const getColumnTypeQuery = `
//           SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
//           WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`;

//           db.query(
//             getColumnTypeQuery,
//             [tableName, oldCustomFieldsName],
//             (err, columnResult) => {
//               if (err) {
//                 console.error("Error fetching column type:", err);
//                 return res.status(500).send("Error fetching column type.");
//               }

//               if (columnResult.length === 0) {
//                 return res
//                   .status(404)
//                   .send("Column not found in the database.");
//               }

//               const columnType = columnResult[0].COLUMN_TYPE;

//               // Rename column while preserving its data type
//               const renameColumnQuery = `
//             ALTER TABLE \`${tableName}\` 
//             CHANGE COLUMN \`${oldCustomFieldsName}\` \`${custom_fields_name}\` ${columnType}`;

//               db.query(renameColumnQuery, (err) => {
//                 if (err) {
//                   console.error(`Error renaming column in ${tableName}:`, err);
//                   return res
//                     .status(500)
//                     .send(
//                       `Error renaming column in ${tableName}: ${err.message}`
//                     );
//                 }

//                 updateListOptions();
//               });
//             }
//           );

//           // Function to update list options and ENUM column
//           function updateListOptions() {
//             if (field_type === "list" && Array.isArray(list_options)) {
//               const fetchOptionsQuery = `SELECT option_key FROM list_options WHERE custom_field_id_f = ?`;

//               db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
//                 if (err) {
//                   console.error("Error fetching existing list options:", err);
//                   return res.status(500).send("Error fetching list options.");
//                 }

//                 const existingKeys = existingOptions.map(
//                   (option) => option.option_key
//                 );
//                 const newKeys = list_options.map((option) => option.option_key);

//                 // Determine which options to delete
//                 const keysToDelete = existingKeys.filter(
//                   (key) => !newKeys.includes(key)
//                 );
//                 const keysToAdd = newKeys.filter(
//                   (key) => !existingKeys.includes(key)
//                 );

//                 let updateQueries = [];

//                 // Delete removed list options
//                 if (keysToDelete.length > 0) {
//                   const deleteQuery = `DELETE FROM list_options WHERE option_key IN (?) AND custom_field_id_f = ?`;
//                   updateQueries.push(
//                     new Promise((resolve, reject) => {
//                       db.query(
//                         deleteQuery,
//                         [keysToDelete, id],
//                         (err, result) => {
//                           if (err) {
//                             console.error("Error deleting list options:", err);
//                             reject(err);
//                           } else {
//                             resolve(result);
//                           }
//                         }
//                       );
//                     })
//                   );
//                 }

//                 // Insert new list options
//                 keysToAdd.forEach((key) => {
//                   const option = list_options.find(
//                     (opt) => opt.option_key === key
//                   );
//                   const insertQuery = `
//                   INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
//                   VALUES (?, ?, ?, NOW(), NOW())`;

//                   updateQueries.push(
//                     new Promise((resolve, reject) => {
//                       db.query(
//                         insertQuery,
//                         [id, option.option_key, option.option_value],
//                         (err, result) => {
//                           if (err) {
//                             console.error("Error inserting list option:", err);
//                             reject(err);
//                           } else {
//                             resolve(result);
//                           }
//                         }
//                       );
//                     })
//                   );
//                 });

//                 // Update ENUM column in cases table
//                 const newEnumValues =
//                   newKeys.length > 0
//                     ? newKeys.map((key) => `'${key}'`).join(",")
//                     : "'N/A'";
//                 const alterEnumQuery = `
//                 ALTER TABLE \`${tableName}\` 
//                 MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

//                 updateQueries.push(
//                   new Promise((resolve, reject) => {
//                     db.query(alterEnumQuery, (err) => {
//                       if (err) {
//                         console.error(
//                           `Error modifying ENUM column in ${tableName}:`,
//                           err
//                         );
//                         reject(err);
//                       } else {
//                         resolve();
//                       }
//                     });
//                   })
//                 );

//                 Promise.all(updateQueries)
//                   .then(() => {
//                     res.send(
//                       "Custom field, list options, and ENUM column updated successfully."
//                     );
//                   })
//                   .catch((err) => {
//                     console.error("Error updating list options:", err);
//                     res.status(500).send("Error updating list options.");
//                   });
//               });
//             } else {
//               res.send("Custom field updated successfully.");
//             }
//           }
//         }
//       );
//     });
//   });
// });
// router.delete("/custom_fields/:id", (req, res) => {
//   const id = req.params.id;

//   // Fetch the custom field details before deletion
//   const fetchQuery =
//     "SELECT custom_fields_name, parent_type FROM custom_fields WHERE custom_fields_id = ?";

//   db.query(fetchQuery, [id], (err, result) => {
//     if (err) {
//       console.error("Error fetching custom field:", err);
//       return res.status(500).send("Error fetching custom field.");
//     }

//     if (result.length === 0) {
//       return res.status(404).send("Custom field not found.");
//     }

//     const { custom_fields_name, parent_type } = result[0];
//     const tableName = PARENT_TABLES[parent_type];

//     // Delete column from the table
//     const alterTableQuery = `ALTER TABLE \`${tableName}\` DROP COLUMN \`${custom_fields_name}\``;

//     db.query(alterTableQuery, (err) => {
//       if (err) {
//         console.error(
//           `Error dropping column ${custom_fields_name} from ${tableName}:`,
//           err
//         );
//         return res
//           .status(500)
//           .send(
//             `Error dropping column ${custom_fields_name} from ${tableName}: ${err.message}`
//           );
//       }

//       // Delete associated list options if any
//       const deleteListOptionsQuery =
//         "DELETE FROM list_options WHERE custom_field_id_f = ?";
//       db.query(deleteListOptionsQuery, [id], (err) => {
//         if (err) {
//           console.error("Error deleting list options:", err);
//           return res.status(500).send("Error deleting list options.");
//         }

//         // Delete the custom field from the database
//         const deleteQuery =
//           "DELETE FROM custom_fields WHERE custom_fields_id = ?";
//         db.query(deleteQuery, [id], (err, result) => {
//           if (err) {
//             console.error("Error deleting custom field:", err);
//             return res.status(500).send("Error deleting custom field.");
//           }

//           if (result.affectedRows === 0) {
//             return res.status(404).send("Custom field not found.");
//           }

//           res.send("Custom field and related column deleted successfully.");
//         });
//       });
//     });
//   });
// });
// module.exports = router;

// routes/customFields.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const pool = db;

// Map of allowed parent_type to actual table names
const PARENT_TABLES = {
  case: "cases",
  // add other parent_type → tableName mappings as needed
};

// GET /custom_fields – fetch all custom fields (optionally filtered by parent_type)
router.get("/custom_fields", (req, res) => {
  const { parent_type } = req.query; // Get parent_type from query params

  let query = `
    SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at,
           cpa.practice_area_id
    FROM custom_fields cf
    LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
    LEFT JOIN custom_field_practice_areas cpa ON cf.custom_fields_id = cpa.custom_field_id_f

  `;

  // Add a WHERE clause if parent_type is provided
  if (parent_type) {
    query += ` WHERE cf.parent_type = ?`;
  }

  query += ` ORDER BY cf.created_at DESC`;

  // Execute the query with or without parameter
  db.query(query, parent_type ? [parent_type] : [], (err, results) => {
    if (err) {
       // If table doesn't exist yet, create it and retry, or just return without practice_areas
      if (err.code === 'ER_NO_SUCH_TABLE' && err.sqlMessage && err.sqlMessage.includes('custom_field_practice_areas')) {
        // Table doesn't exist yet - query without practice areas join
        const fallbackQuery = `
          SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
          FROM custom_fields cf
          LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
          ${parent_type ? 'WHERE cf.parent_type = ?' : ''}
          ORDER BY cf.created_at DESC
        `;
        return db.query(fallbackQuery, parent_type ? [parent_type] : [], (fallbackErr, fallbackResults) => {
          if (fallbackErr) {
            console.error("Error fetching custom fields:", fallbackErr);
            return res.status(500).send("Error fetching custom fields.");
          }
          // Process results without practice areas
          let customFields = {};
          fallbackResults.forEach((row) => {
            if (!customFields[row.custom_fields_id]) {
              customFields[row.custom_fields_id] = {
                custom_fields_id: row.custom_fields_id,
                custom_fields_name: row.custom_fields_name,
                parent_type: row.parent_type,
                field_type: row.field_type,
                created_at: row.created_at,
                updated_at: row.updated_at,
                list_options: [],
                practice_areas: [],
                _seen_list_options: new Set(), // Track seen list option IDs
              };
            }
            // Add list option only if not already added (avoid duplicates)
            if (row.field_type === "list" && row.list_options_id && 
                !customFields[row.custom_fields_id]._seen_list_options.has(row.list_options_id)) {
              customFields[row.custom_fields_id]._seen_list_options.add(row.list_options_id);
              customFields[row.custom_fields_id].list_options.push({
                list_options_id: row.list_options_id,
                option_key: row.option_key,
                option_value: row.option_value,
                created_at: row.option_created_at,
                updated_at: row.option_updated_at,
              });
            }
          });
          // Clean up the tracking sets before returning
          Object.values(customFields).forEach(field => {
            delete field._seen_list_options;
          });
          return res.json(Object.values(customFields));
        });
      }
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
           practice_areas: [],
          _seen_list_options: new Set(), // Track seen list option IDs to avoid duplicates
        };
      }

      // if (row.field_type === "list" && row.list_options_id) {
       // Add list option only if not already added (avoid duplicates from JOIN)
      if (row.field_type === "list" && row.list_options_id && 
          !customFields[row.custom_fields_id]._seen_list_options.has(row.list_options_id)) {
        customFields[row.custom_fields_id]._seen_list_options.add(row.list_options_id);
        customFields[row.custom_fields_id].list_options.push({
          list_options_id: row.list_options_id,
          option_key: row.option_key,
          option_value: row.option_value,
          created_at: row.option_created_at,
          updated_at: row.option_updated_at,
        });
      }

      // Collect practice area IDs
      if (row.practice_area_id && !customFields[row.custom_fields_id].practice_areas.includes(row.practice_area_id)) {
        customFields[row.custom_fields_id].practice_areas.push(row.practice_area_id);
      }
    });

    // Clean up the tracking sets before returning
    Object.values(customFields).forEach(field => {
      delete field._seen_list_options;
    });

    res.json(Object.values(customFields));
  });
});

// GET /custom_fields/:id – fetch single custom field
router.get("/custom_fields/:id", (req, res) => {
  const id = req.params.id;
  const query = `
    SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at,
           cpa.practice_area_id
    FROM custom_fields cf
    LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
    LEFT JOIN custom_field_practice_areas cpa ON cf.custom_fields_id = cpa.custom_field_id_f
    WHERE cf.custom_fields_id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
       // If table doesn't exist yet, query without practice areas join
      if (err.code === 'ER_NO_SUCH_TABLE' && err.sqlMessage && err.sqlMessage.includes('custom_field_practice_areas')) {
        const fallbackQuery = `
          SELECT cf.*, lo.list_options_id, lo.option_key, lo.option_value, lo.created_at AS option_created_at, lo.updated_at AS option_updated_at
          FROM custom_fields cf
          LEFT JOIN list_options lo ON cf.custom_fields_id = lo.custom_field_id_f
          WHERE cf.custom_fields_id = ?
        `;
        return db.query(fallbackQuery, [id], (fallbackErr, fallbackResults) => {
          if (fallbackErr) {
            console.error("Error fetching custom field:", fallbackErr);
            return res.status(500).send("Error fetching custom field.");
          }
          if (fallbackResults.length === 0) {
            return res.status(404).send("Custom field not found.");
          }
          let customField = {
            custom_fields_id: fallbackResults[0].custom_fields_id,
            custom_fields_name: fallbackResults[0].custom_fields_name,
            parent_type: fallbackResults[0].parent_type,
            field_type: fallbackResults[0].field_type,
            created_at: fallbackResults[0].created_at,
            updated_at: fallbackResults[0].updated_at,
            list_options: [],
            practice_areas: [],
          };
          // Track seen list option IDs to avoid duplicates
          const seenListOptions = new Set();
          fallbackResults.forEach((row) => {
            if (row.field_type === "list" && row.list_options_id && !seenListOptions.has(row.list_options_id)) {
              seenListOptions.add(row.list_options_id);
              customField.list_options.push({
                list_options_id: row.list_options_id,
                option_key: row.option_key,
                option_value: row.option_value,
                created_at: row.option_created_at,
                updated_at: row.option_updated_at,
              });
            }
          });
          return res.json(customField);
        });
      }
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
      practice_areas: [],

    };
    // Track seen list option IDs to avoid duplicates from JOIN
    const seenListOptions = new Set();

    results.forEach((row) => {
      // if (row.field_type === "list" && row.list_options_id) {
       // Add list option only if not already added (avoid duplicates from JOIN)
      if (row.field_type === "list" && row.list_options_id && !seenListOptions.has(row.list_options_id)) {
        seenListOptions.add(row.list_options_id);
        customField.list_options.push({
          list_options_id: row.list_options_id,
          option_key: row.option_key,
          option_value: row.option_value,
          created_at: row.option_created_at,
          updated_at: row.option_updated_at,
        });
      }

      // Collect practice area IDs
      if (row.practice_area_id && !customField.practice_areas.includes(row.practice_area_id)) {
        customField.practice_areas.push(row.practice_area_id);
      }
    });

    res.json(customField);
  });
});

// POST /custom_fields – create a new custom field (with list options if list type)
// POST /custom_fields – create a new custom field with optional list options
router.post("/custom_fields", (req, res) => {
  let { custom_fields_name, parent_type, field_type, list_options, practice_areas  } = req.body;
  custom_fields_name = custom_fields_name?.trim().replace(/\s+/g, "_").toLowerCase();
  if (!custom_fields_name || !parent_type || !field_type) {
    return res.status(400).send("All fields are required.");
  }

  // Validate parent_type against whitelist
  if (!PARENT_TABLES[parent_type]) {
    return res.status(400).send("Invalid parent_type.");
  }

  pool.getConnection((err, conn) => {
    if (err) {
      console.error("DB connection error:", err);
      return res.status(500).send("Database connection error.");
    }

    conn.beginTransaction(err => {
      if (err) {
        conn.release();
        console.error("Transaction start error:", err);
        return res.status(500).send("Transaction error.");
      }

      // 1) Duplicate check
      const checkDup = "SELECT COUNT(*) AS count FROM custom_fields WHERE custom_fields_name = ?";
      conn.query(checkDup, [custom_fields_name], (err, results) => {
        if (err) {
          return conn.rollback(() => {
            conn.release();
            console.error("Duplicate check error:", err);
            return res.status(500).send("Error checking duplicate custom field.");
          });
        }
        if (results[0].count > 0) {
          conn.release();
          return res.status(409).send("Custom field already exists.");
        }

        // 2) Insert base record
        const insertSQL = 
          "INSERT INTO custom_fields (custom_fields_name, parent_type, field_type, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())";
        conn.query(insertSQL, [custom_fields_name, parent_type, field_type], (err, result) => {
          if (err) {
            return conn.rollback(() => {
              conn.release();
              console.error("Insert error:", err);
              return res.status(500).send("Error adding custom field.");
            });
          }

          const custom_fields_id = result.insertId;
          const tableName = PARENT_TABLES[parent_type];

          // 3) Build ALTER TABLE to add the new column
          let alterTableSQL = "";
          if (field_type === "long_text") {
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` LONGTEXT`;
          } else if (field_type === "short_text") {
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` VARCHAR(255)`;
          } else if (field_type === "number") {
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` INT`;
          } else if (field_type === "currency") {
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` DECIMAL(10,2)`;
          } else if (field_type === "date") {
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` DATE`;
          } else if (field_type === "list" && Array.isArray(list_options) && list_options.length) {
            const enumVals = list_options.map(o => `'${o.option_value}'`).join(",");
            alterTableSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${custom_fields_name}\` ENUM(${enumVals})`;
          }

          conn.query(alterTableSQL, err => {
            if (err) {
              return conn.rollback(() => {
                conn.release();
                console.error(`Alter table error (${tableName}):`, err);
                return res.status(500).send(`Error modifying table ${tableName}: ${err.message}`);
              });
            }

            // 4) If it's a list type, bulk‐insert list_options
            if (field_type === "list" && Array.isArray(list_options) && list_options.length) {
              const optsSQL = 
                "INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) VALUES ?";
              const optsVals = list_options.map(o => [
                custom_fields_id,
                o.option_key,
                o.option_value,
                new Date(),
                new Date()
              ]);
              conn.query(optsSQL, [optsVals], err => {
                if (err) {
                  return conn.rollback(() => {
                    conn.release();
                    console.error("List options insert error:", err);
                    return res.status(500).send("Error adding list options.");
                  });
                }
                // 5) commit transaction
            //     conn.commit(err => {
            //       conn.release();
            //       if (err) {
            //         console.error("Commit error:", err);
            //         return res.status(500).send("Error committing transaction.");
            //       }
            //       return res.status(201).json({
            //         custom_fields_id,
            //         custom_fields_name,
            //         parent_type,
            //         field_type,
            //         list_options
            //       });
            //     });
            //   });
            // } else {
            //   // No list options: just commit
            //   conn.commit(err => {
            //     conn.release();
            //     if (err) {
            //       console.error("Commit error:", err);
            //       return res.status(500).send("Error committing transaction.");
            //     }
            //     return res.status(201).json({
            //       custom_fields_id,
            //       custom_fields_name,
            //       parent_type,
            //       field_type
            //     });
            //   });
            // }
             // 5) Insert practice areas if provided
                insertPracticeAreas();
              });
            } else {
              // No list options: insert practice areas
              insertPracticeAreas();
            }

            // Helper function to insert practice areas
            function insertPracticeAreas() {
              if (Array.isArray(practice_areas) && practice_areas.length > 0) {
                // Create junction table if it doesn't exist
                const createTableSQL = `
                  CREATE TABLE IF NOT EXISTS custom_field_practice_areas (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    custom_field_id_f BIGINT NOT NULL,
                    practice_area_id INT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (custom_field_id_f) REFERENCES custom_fields(custom_fields_id) ON DELETE CASCADE,
                    UNIQUE KEY unique_custom_field_practice_area (custom_field_id_f, practice_area_id)
                  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                `;
                
                conn.query(createTableSQL, (err) => {
                  if (err) {
                    return conn.rollback(() => {
                      conn.release();
                      console.error("Error creating custom_field_practice_areas table:", err);
                      return res.status(500).send("Error creating practice areas table.");
                    });
                  }

                  // Insert practice areas
                  const practiceAreaSQL = 
                    "INSERT INTO custom_field_practice_areas (custom_field_id_f, practice_area_id) VALUES ?";
                  const practiceAreaVals = practice_areas.map(paId => [custom_fields_id, Number(paId)]);
                  
                  conn.query(practiceAreaSQL, [practiceAreaVals], err => {
                    if (err) {
                      return conn.rollback(() => {
                        conn.release();
                        console.error("Practice areas insert error:", err);
                        return res.status(500).send("Error adding practice areas.");
                      });
                    }
                    // Commit transaction
                    conn.commit(err => {
                      conn.release();
                      if (err) {
                        console.error("Commit error:", err);
                        return res.status(500).send("Error committing transaction.");
                      }
                      return res.status(201).json({
                        custom_fields_id,
                        custom_fields_name,
                        parent_type,
                        field_type,
                        list_options: list_options || [],
                        practice_areas: practice_areas || []
                      });
                    });
                  });
                });
              } else {
                // No practice areas: just commit
                conn.commit(err => {
                  conn.release();
                  if (err) {
                    console.error("Commit error:", err);
                    return res.status(500).send("Error committing transaction.");
                  }
                  return res.status(201).json({
                    custom_fields_id,
                    custom_fields_name,
                    parent_type,
                    field_type,
                    list_options: list_options || [],
                    practice_areas: []
                  });
                });
              }
            }
          });
        });
      });
    });
  });
});
router.put("/custom_fields/:id/full_update", (req, res) => {
  const id = req.params.id;
  const { custom_fields_name, parent_type, field_type, list_options, practice_areas } =
    req.body;

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
      return res
        .status(409)
        .send("Custom field with the same name already exists.");
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
      console.log("🔍 Renaming column:", {
        tableName: PARENT_TABLES[oldParentType],
        oldCustomFieldsName,
        id,
      });

      // Update the custom field details
      const updateFieldQuery = `
        UPDATE custom_fields 
        SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
        WHERE custom_fields_id = ?`;

      db.query(
        updateFieldQuery,
        [custom_fields_name, parent_type, field_type, id],
        (err, result) => {
          if (err) {
            console.error("Error updating custom field:", err);
            return res.status(500).send("Error updating custom field.");
          }

          const tableName = PARENT_TABLES[oldParentType];
          // Slugify the old custom field name to match the actual column
          const oldColumnName = oldCustomFieldsName.trim().replace(/\s+/g, "_").toLowerCase();

          // Get the column type dynamically, scoped to the current database
          const getColumnTypeQuery = `
            SELECT COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = ?
              AND COLUMN_NAME  = ?
          `;

          db.query(
            getColumnTypeQuery,
            [tableName, oldColumnName],
            (err, columnResult) => {
              if (err) {
                console.error("Error fetching column type:", err);
                return res.status(500).send("Error fetching column type.");
              }

              if (columnResult.length === 0) {
                return res
                  .status(404)
                  .send("Column not found in the database.");
              }

              const columnType = columnResult[0].COLUMN_TYPE;

              // Rename column while preserving its data type
              const renameColumnQuery = `
                ALTER TABLE \`${tableName}\`
                CHANGE COLUMN \`${oldColumnName}\` \`${custom_fields_name}\` ${columnType}
              `;

              db.query(renameColumnQuery, (err) => {
                if (err) {
                  console.error(`Error renaming column in ${tableName}:`, err);
                  return res
                    .status(500)
                    .send(
                      `Error renaming column in ${tableName}: ${err.message}`
                    );
                }

                updateListOptions();
              });
            }
          );

          // Function to update list options and ENUM column
          function updateListOptions() {
            if (field_type === "list" && Array.isArray(list_options)) {
              const fetchOptionsQuery = `SELECT list_options_id FROM list_options WHERE custom_field_id_f = ?`;

              db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
                if (err) {
                  console.error("Error fetching existing list options:", err);
                  return res.status(500).send("Error fetching list options.");
                }

                const existingIds = existingOptions.map(
                  (option) => option.list_options_id
                );
                const providedIds = list_options
                  .map((option) => option.list_options_id)
                  .filter((id) => id !== undefined);
                const providedIds2 = list_options
                  .map((option) => option.option_value)
                  .filter((id) => id !== undefined);

                // Determine which options to delete
                const idsToDelete = existingIds.filter(
                  (existingId) => !providedIds.includes(existingId)
                );
                const idsToAdd = providedIds.filter(
                  (newId) => !existingIds.includes(newId)
                );

                let updateQueries = [];
               // Update existing list options
                list_options.forEach((option) => {
                  if (option.list_options_id && existingIds.includes(option.list_options_id)) {
                    // If option_key is not provided, preserve the existing one by not updating it
                    const updateQuery = option.option_key !== undefined && option.option_key !== null
                      ? `UPDATE list_options 
                         SET option_key = ?, option_value = ?, updated_at = NOW() 
                         WHERE list_options_id = ? AND custom_field_id_f = ?`
                      : `UPDATE list_options 
                         SET option_value = ?, updated_at = NOW() 
                         WHERE list_options_id = ? AND custom_field_id_f = ?`;

                    const updateParams = option.option_key !== undefined && option.option_key !== null
                      ? [option.option_key, option.option_value, option.list_options_id, id]
                      : [option.option_value, option.list_options_id, id];

                    updateQueries.push(
                      new Promise((resolve, reject) => {
                        db.query(
                          updateQuery,
                          updateParams,
                          (err, result) => {
                            if (err) {
                              console.error("Error updating list option:", err);
                              reject(err);
                            } else {
                              resolve(result);
                            }
                          }
                        );
                      })
                    );
                  }
                });

                // Delete removed list options
                if (idsToDelete.length > 0) {
                  const deleteQuery = `DELETE FROM list_options WHERE list_options_id IN (?) AND custom_field_id_f = ?`;
                  updateQueries.push(
                    new Promise((resolve, reject) => {
                      db.query(
                        deleteQuery,
                        [idsToDelete, id],
                        (err, result) => {
                          if (err) {
                            console.error("Error deleting list options:", err);
                            reject(err);
                          } else {
                            resolve(result);
                          }
                        }
                      );
                    })
                  );
                }

                // Insert new list options
                list_options.forEach((option) => {
                  // if (!existingIds.includes(option.list_options_id)) {
                if (!option.list_options_id || !existingIds.includes(option.list_options_id)) {

                    const insertQuery = `
                    INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
                    VALUES (?, ?, ?, NOW(), NOW())`;

                    updateQueries.push(
                      new Promise((resolve, reject) => {
                        db.query(
                          insertQuery,
                          [id, option.option_key, option.option_value],
                          (err, result) => {
                            if (err) {
                              console.error(
                                "Error inserting list option:",
                                err
                              );
                              reject(err);
                            } else {
                              resolve(result);
                            }
                          }
                        );
                      })
                    );
                  }
                });

                // Update ENUM column in cases table based on list_options_id
                const newEnumValues =
                  providedIds2.length > 0
                    ? providedIds2.map((id) => `'${id}'`).join(",")
                    : "'N/A'";
                const alterEnumQuery = `
                ALTER TABLE \`${tableName}\` 
                MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

                updateQueries.push(
                  new Promise((resolve, reject) => {
                    db.query(alterEnumQuery, (err) => {
                      if (err) {
                        console.error(
                          `Error modifying ENUM column in ${tableName}:`,
                          err
                        );
                        reject(err);
                      } else {
                        resolve();
                      }
                    });
                  })
                );

                Promise.all(updateQueries)
                  .then(() => {
                    // res.send(
                    //   "Custom field, list options, and ENUM column updated successfully."
                    // );
                    // Update practice areas
                    updatePracticeAreas();
                  })
                  .catch((err) => {
                    console.error("Error updating list options:", err);
                    res.status(500).send("Error updating list options.");
                  });
              });
          } else {
              // No list options: update practice areas
              updatePracticeAreas();
            }

            // Helper function to update practice areas
            function updatePracticeAreas() {
              // Create junction table if it doesn't exist
              const createTableSQL = `
                CREATE TABLE IF NOT EXISTS custom_field_practice_areas (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  custom_field_id_f INT NOT NULL,
                  practice_area_id INT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (custom_field_id_f) REFERENCES custom_fields(custom_fields_id) ON DELETE CASCADE,
                  UNIQUE KEY unique_custom_field_practice_area (custom_field_id_f, practice_area_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
              `;
              
              db.query(createTableSQL, (err) => {
                if (err) {
                  console.error("Error creating/checking custom_field_practice_areas table:", err);
                  return res.status(500).send("Error with practice areas table.");
                }

                // Delete existing practice areas for this custom field
                const deleteSQL = "DELETE FROM custom_field_practice_areas WHERE custom_field_id_f = ?";
                db.query(deleteSQL, [id], (err) => {
                  if (err) {
                    console.error("Error deleting practice areas:", err);
                    return res.status(500).send("Error updating practice areas.");
                  }

                  // Insert new practice areas if provided
                  if (Array.isArray(practice_areas) && practice_areas.length > 0) {
                    const insertSQL = 
                      "INSERT INTO custom_field_practice_areas (custom_field_id_f, practice_area_id) VALUES ?";
                    const practiceAreaVals = practice_areas.map(paId => [id, Number(paId)]);
                    
                    db.query(insertSQL, [practiceAreaVals], (err) => {
                      if (err) {
                        console.error("Error inserting practice areas:", err);
                        return res.status(500).send("Error updating practice areas.");
                      }
                      res.send("Custom field updated successfully.");
                    });
                  } else {
                    res.send("Custom field updated successfully.");
                  }
                });
              });
            }
          }
        }
      );
    });
  });
});
// PUT /custom_fields/:id – update custom field basic details (or full update endpoints can be similarly set up)
router.put("/custom_fields/:id", (req, res) => {
  const id = req.params.id;
  const { custom_fields_name, parent_type, field_type } = req.body;

  if (!custom_fields_name || !parent_type || !field_type) {
    return res.status(400).send("All fields are required.");
  }

  const slugName = custom_fields_name.trim().replace(/\s+/g, "_").toLowerCase();

  const updateQuery = `
    UPDATE custom_fields 
    SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
    WHERE custom_fields_id = ?`;

  db.query(
    updateQuery,
    [slugName, parent_type, field_type, id],
    (err, result) => {
      if (err) {
        console.error("Error updating custom field:", err);
        return res.status(500).send("Error updating custom field.");
      }

      if (result.affectedRows === 0) {
        return res.status(404).send("Custom field not found.");
      }

      res.send("Custom field updated successfully.");
    }
  );
});
router.put("/custom_fields/:id/list_options", (req, res) => {
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

      db.query(
        updateQuery,
        [option.option_key, option.option_value, option.list_options_id],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
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
// PUT /custom_fields/:id/list_options – update only list options for a custom field
// router.put("/custom_fields/:id/full_update", (req, res) => {
//   const id = req.params.id;
//   const { custom_fields_name, parent_type, field_type, list_options, practice_areas  } =
//     req.body;

//   if (!custom_fields_name || !parent_type || !field_type) {
//     return res.status(400).send("All fields are required.");
//   }

//   // Check if new custom_fields_name already exists
//   const checkDuplicateQuery = `
//     SELECT COUNT(*) AS count FROM custom_fields 
//     WHERE custom_fields_name = ? AND custom_fields_id != ?`;

//   db.query(checkDuplicateQuery, [custom_fields_name, id], (err, results) => {
//     if (err) {
//       console.error("Error checking duplicate custom field:", err);
//       return res.status(500).send("Error checking duplicate custom field.");
//     }

//     if (results[0].count > 0) {
//       return res
//         .status(409)
//         .send("Custom field with the same name already exists.");
//     }

//     // Fetch the current custom field details
//     const fetchFieldQuery = `
//       SELECT custom_fields_name, parent_type, field_type 
//       FROM custom_fields WHERE custom_fields_id = ?`;

//     db.query(fetchFieldQuery, [id], (err, fieldResults) => {
//       if (err) {
//         console.error("Error fetching custom field:", err);
//         return res.status(500).send("Error fetching custom field.");
//       }

//       if (fieldResults.length === 0) {
//         return res.status(404).send("Custom field not found.");
//       }

//       const oldCustomFieldsName = fieldResults[0].custom_fields_name;
//       const oldParentType = fieldResults[0].parent_type;
//       const oldFieldType = fieldResults[0].field_type;

//       // Update the custom field details
//       const updateFieldQuery = `
//         UPDATE custom_fields 
//         SET custom_fields_name = ?, parent_type = ?, field_type = ?, updated_at = NOW() 
//         WHERE custom_fields_id = ?`;

//       db.query(
//         updateFieldQuery,
//         [custom_fields_name, parent_type, field_type, id],
//         (err, result) => {
//           if (err) {
//             console.error("Error updating custom field:", err);
//             return res.status(500).send("Error updating custom field.");
//           }

//           let tableName = oldParentType === "case" ? "cases" : oldParentType;

//           // Get the column type dynamically
//           const getColumnTypeQuery = `
//           SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
//           WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`;

//           db.query(
//             getColumnTypeQuery,
//             [tableName, oldCustomFieldsName],
//             (err, columnResult) => {
//               if (err) {
//                 console.error("Error fetching column type:", err);
//                 return res.status(500).send("Error fetching column type.");
//               }

//               if (columnResult.length === 0) {
//                 return res
//                   .status(404)
//                   .send("Column not found in the database.");
//               }

//               const columnType = columnResult[0].COLUMN_TYPE;

//               // Rename column while preserving its data type
//               const renameColumnQuery = `
//             ALTER TABLE \`${tableName}\` 
//             CHANGE COLUMN \`${oldCustomFieldsName}\` \`${custom_fields_name}\` ${columnType}`;

//               db.query(renameColumnQuery, (err) => {
//                 if (err) {
//                   console.error(`Error renaming column in ${tableName}:`, err);
//                   return res
//                     .status(500)
//                     .send(
//                       `Error renaming column in ${tableName}: ${err.message}`
//                     );
//                 }

//                 updateListOptions();
//               });
//             }
//           );

//           // Function to update list options and ENUM column
//           function updateListOptions() {
//             if (field_type === "list" && Array.isArray(list_options)) {
//               const fetchOptionsQuery = `SELECT option_key FROM list_options WHERE custom_field_id_f = ?`;

//               db.query(fetchOptionsQuery, [id], (err, existingOptions) => {
//                 if (err) {
//                   console.error("Error fetching existing list options:", err);
//                   return res.status(500).send("Error fetching list options.");
//                 }

//                 const existingKeys = existingOptions.map(
//                   (option) => option.option_key
//                 );
//                 const newKeys = list_options.map((option) => option.option_key);

//                 // Determine which options to delete
//                 const keysToDelete = existingKeys.filter(
//                   (key) => !newKeys.includes(key)
//                 );
//                 const keysToAdd = newKeys.filter(
//                   (key) => !existingKeys.includes(key)
//                 );

//                 let updateQueries = [];

//                 // Delete removed list options
//                 if (keysToDelete.length > 0) {
//                   const deleteQuery = `DELETE FROM list_options WHERE option_key IN (?) AND custom_field_id_f = ?`;
//                   updateQueries.push(
//                     new Promise((resolve, reject) => {
//                       db.query(
//                         deleteQuery,
//                         [keysToDelete, id],
//                         (err, result) => {
//                           if (err) {
//                             console.error("Error deleting list options:", err);
//                             reject(err);
//                           } else {
//                             resolve(result);
//                           }
//                         }
//                       );
//                     })
//                   );
//                 }

//                 // Insert new list options
//                 keysToAdd.forEach((key) => {
//                   const option = list_options.find(
//                     (opt) => opt.option_key === key
//                   );
//                   const insertQuery = `
//                   INSERT INTO list_options (custom_field_id_f, option_key, option_value, created_at, updated_at) 
//                   VALUES (?, ?, ?, NOW(), NOW())`;

//                   updateQueries.push(
//                     new Promise((resolve, reject) => {
//                       db.query(
//                         insertQuery,
//                         [id, option.option_key, option.option_value],
//                         (err, result) => {
//                           if (err) {
//                             console.error("Error inserting list option:", err);
//                             reject(err);
//                           } else {
//                             resolve(result);
//                           }
//                         }
//                       );
//                     })
//                   );
//                 });

//                 // Update ENUM column in cases table
//                 const newEnumValues =
//                   newKeys.length > 0
//                     ? newKeys.map((key) => `'${key}'`).join(",")
//                     : "'N/A'";
//                 const alterEnumQuery = `
//                 ALTER TABLE \`${tableName}\` 
//                 MODIFY COLUMN \`${custom_fields_name}\` ENUM(${newEnumValues})`;

//                 updateQueries.push(
//                   new Promise((resolve, reject) => {
//                     db.query(alterEnumQuery, (err) => {
//                       if (err) {
//                         console.error(
//                           `Error modifying ENUM column in ${tableName}:`,
//                           err
//                         );
//                         reject(err);
//                       } else {
//                         resolve();
//                       }
//                     });
//                   })
//                 );

//                 Promise.all(updateQueries)
//                   .then(() => {
//                     // res.send(
//                     //   "Custom field, list options, and ENUM column updated successfully."
//                     // );
//                      // Update practice areas
//                     updatePracticeAreas();
//                   })
//                   .catch((err) => {
//                     console.error("Error updating list options:", err);
//                     res.status(500).send("Error updating list options.");
//                   });
//               });
//              } else {
//               // No list options: update practice areas
//               updatePracticeAreas();
//             }

//             // Helper function to update practice areas
//             function updatePracticeAreas() {
//               // Create junction table if it doesn't exist
//               const createTableSQL = `
//                 CREATE TABLE IF NOT EXISTS custom_field_practice_areas (
//                   id INT AUTO_INCREMENT PRIMARY KEY,
//                   custom_field_id_f INT NOT NULL,
//                   practice_area_id INT NOT NULL,
//                   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//                   FOREIGN KEY (custom_field_id_f) REFERENCES custom_fields(custom_fields_id) ON DELETE CASCADE,
//                   UNIQUE KEY unique_custom_field_practice_area (custom_field_id_f, practice_area_id)
//                 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
//               `;
              
//               db.query(createTableSQL, (err) => {
//                 if (err) {
//                   console.error("Error creating/checking custom_field_practice_areas table:", err);
//                   return res.status(500).send("Error with practice areas table.");
//                 }

//                 // Delete existing practice areas for this custom field
//                 const deleteSQL = "DELETE FROM custom_field_practice_areas WHERE custom_field_id_f = ?";
//                 db.query(deleteSQL, [id], (err) => {
//                   if (err) {
//                     console.error("Error deleting practice areas:", err);
//                     return res.status(500).send("Error updating practice areas.");
//                   }

//                   // Insert new practice areas if provided
//                   if (Array.isArray(practice_areas) && practice_areas.length > 0) {
//                     const insertSQL = 
//                       "INSERT INTO custom_field_practice_areas (custom_field_id_f, practice_area_id) VALUES ?";
//                     const practiceAreaVals = practice_areas.map(paId => [id, Number(paId)]);
                    
//                     db.query(insertSQL, [practiceAreaVals], (err) => {
//                       if (err) {
//                         console.error("Error inserting practice areas:", err);
//                         return res.status(500).send("Error updating practice areas.");
//                       }
//                       res.send("Custom field updated successfully.");
//                     });
//                   } else {
//                     res.send("Custom field updated successfully.");
//                   }
//                 });
//               });
//             }
//           }
//         }
//       );
//     });
//   });
// });
router.delete("/custom_fields/:id", (req, res) => {
  const id = req.params.id;

  // Fetch the custom field details before deletion
  const fetchQuery =
    "SELECT custom_fields_name, parent_type FROM custom_fields WHERE custom_fields_id = ?";

  db.query(fetchQuery, [id], (err, result) => {
    if (err) {
      console.error("Error fetching custom field:", err);
      return res.status(500).send("Error fetching custom field.");
    }

    if (result.length === 0) {
      return res.status(404).send("Custom field not found.");
    }

    const { custom_fields_name, parent_type } = result[0];
    const tableName = PARENT_TABLES[parent_type];

    // Delete column from the table
    const alterTableQuery = `ALTER TABLE \`${tableName}\` DROP COLUMN \`${custom_fields_name}\``;

    db.query(alterTableQuery, (err) => {
      if (err) {
        console.error(
          `Error dropping column ${custom_fields_name} from ${tableName}:`,
          err
        );
        return res
          .status(500)
          .send(
            `Error dropping column ${custom_fields_name} from ${tableName}: ${err.message}`
          );
      }

      // Delete associated list options if any
      const deleteListOptionsQuery =
        "DELETE FROM list_options WHERE custom_field_id_f = ?";
      db.query(deleteListOptionsQuery, [id], (err) => {
        if (err) {
          console.error("Error deleting list options:", err);
          return res.status(500).send("Error deleting list options.");
        }

        // Delete the custom field from the database
        const deleteQuery =
          "DELETE FROM custom_fields WHERE custom_fields_id = ?";
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
module.exports = router;