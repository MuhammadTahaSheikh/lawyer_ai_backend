/**
 * PostgreSQL-compatible DDL helpers for custom field columns on parent tables.
 */

function slugifyFieldName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function pgColumnTypeFromRow(row) {
  if (!row) return "TEXT";
  const dt = row.data_type || row.DATA_TYPE;
  if (dt === "character varying") {
    return row.character_maximum_length
      ? `VARCHAR(${row.character_maximum_length})`
      : "TEXT";
  }
  if (dt === "text") return "TEXT";
  if (dt === "integer") return "INTEGER";
  if (dt === "bigint") return "BIGINT";
  if (dt === "numeric") {
    const p = row.numeric_precision;
    const s = row.numeric_scale ?? 0;
    return p ? `NUMERIC(${p},${s})` : "NUMERIC(10,2)";
  }
  if (dt === "date") return "DATE";
  if (dt === "timestamp with time zone" || dt === "timestamp without time zone") {
    return "TIMESTAMPTZ";
  }
  return (row.udt_name || "text").toUpperCase();
}

const GET_COLUMN_TYPE_SQL = `
  SELECT data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = ?
    AND column_name = ?
`;

function buildAddColumnSql(tableName, columnName, fieldType) {
  const col = slugifyFieldName(columnName);
  let pgType = "TEXT";
  if (fieldType === "long_text") pgType = "TEXT";
  else if (fieldType === "short_text") pgType = "VARCHAR(255)";
  else if (fieldType === "number") pgType = "INTEGER";
  else if (fieldType === "currency") pgType = "NUMERIC(10,2)";
  else if (fieldType === "date") pgType = "DATE";
  else if (fieldType === "list") pgType = "TEXT";

  return `ALTER TABLE \`${tableName}\` ADD COLUMN \`${col}\` ${pgType}`;
}

function buildRenameColumnSql(tableName, oldColumnName, newColumnName) {
  const oldCol = slugifyFieldName(oldColumnName);
  const newCol = slugifyFieldName(newColumnName);
  return `ALTER TABLE \`${tableName}\` RENAME COLUMN \`${oldCol}\` TO \`${newCol}\``;
}

/** PostgreSQL stores list values in list_options; column stays TEXT — no ENUM alter. */
function buildModifyListColumnSql(_tableName, _columnName, _enumValues) {
  return null;
}

const CREATE_PRACTICE_AREAS_JUNCTION_SQL = `
  CREATE TABLE IF NOT EXISTS custom_field_practice_areas (
    id SERIAL PRIMARY KEY,
    custom_field_id_f BIGINT NOT NULL,
    practice_area_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (custom_field_id_f, practice_area_id),
    FOREIGN KEY (custom_field_id_f) REFERENCES custom_fields(custom_fields_id) ON DELETE CASCADE
  )
`;

module.exports = {
  slugifyFieldName,
  pgColumnTypeFromRow,
  GET_COLUMN_TYPE_SQL,
  buildAddColumnSql,
  buildRenameColumnSql,
  buildModifyListColumnSql,
  CREATE_PRACTICE_AREAS_JUNCTION_SQL,
};
