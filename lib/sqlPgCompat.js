/**
 * Translate common MySQL syntax in route SQL to PostgreSQL-compatible forms.
 */

function parseStrToDate(expr, format) {
  const e = expr.trim();
  const t = `(${e})::text`;
  if (format === '%Y-%m-%d') {
    return `(CASE WHEN ${t} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${e})::timestamp::date ELSE NULL END)`;
  }
  if (format === '%m/%d/%y' || format === '%m/%d/%Y') {
    return `(CASE WHEN ${t} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}' THEN TO_DATE(${t}, 'MM/DD/YY') WHEN ${t} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${e})::timestamp::date ELSE NULL END)`;
  }
  return `TO_DATE(${t}, 'MM/DD/YY')`;
}

function replaceStrToDate(sql) {
  return sql.replace(
    /STR_TO_DATE\s*\(\s*([^,]+?)\s*,\s*'(%Y-%m-%d|%m\/%d\/%y|%m\/%d\/%Y)'\s*\)/gi,
    (_, expr, fmt) => parseStrToDate(expr, fmt)
  );
}

function mysqlToPgSql(sql) {
  let s = sql.replace(/\bSQL_CALC_FOUND_ROWS\b/gi, '');
  s = s.replace(/`([^`]+)`/g, '"$1"');

  // Preserve camelCase SELECT aliases (PG lowercases unquoted identifiers)
  s = s.replace(/\bAS\s+([a-z][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g, 'AS "$1"');

  s = replaceStrToDate(s);

  s = s.replace(
    /GROUP_CONCAT\s*\(\s*DISTINCT\s+([\s\S]+?)\s+SEPARATOR\s+'([^']*)'\s*\)/gi,
    "STRING_AGG(DISTINCT ($1)::text, '$2')"
  );
  s = s.replace(
    /GROUP_CONCAT\s*\(\s*([\s\S]+?)\s+SEPARATOR\s+'([^']*)'\s*\)/gi,
    "STRING_AGG(($1)::text, '$2')"
  );
  s = s.replace(
    /GROUP_CONCAT\s*\(\s*DISTINCT\s+([^)]+)\)/gi,
    "STRING_AGG(DISTINCT ($1)::text, ',')"
  );
  s = s.replace(/GROUP_CONCAT\s*\(\s*([^)]+)\)/gi, "STRING_AGG(($1)::text, ',')");

  s = s.replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE');
  s = s.replace(/\bNOW\s*\(\s*\)/gi, 'NOW()');
  s = s.replace(/\bDATE\s*\(\s*([^)]+)\s*\)/gi, '($1)::date');
  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  s = s.replace(/\bDATABASE\s*\(\s*\)/gi, 'current_database()');

  // MySQL ISNULL(expr) in ORDER BY — 1 when null (sort nulls first)
  s = s.replace(/\bISNULL\s*\(\s*([^)]+)\s*\)/gi, '(CASE WHEN $1 IS NULL THEN 1 ELSE 0 END)');

  s = s.replace(
    /\bDATE_FORMAT\s*\(\s*([^,]+)\s*,\s*'%Y-%m-01'\s*\)/gi,
    "date_trunc('month', $1::timestamp)::date"
  );
  s = s.replace(
    /\bDATE_FORMAT\s*\(\s*([^,]+)\s*,\s*'%Y-01-01'\s*\)/gi,
    "date_trunc('year', $1::timestamp)::date"
  );

  s = s.replace(
    /\bDATE_SUB\s*\(\s*([^,]+)\s*,\s*INTERVAL\s+(\d+)\s+(DAY|MONTH|YEAR)\s*\)/gi,
    (_, expr, n, unit) => {
      const u = unit.toUpperCase() === 'DAY' ? 'days' : unit.toUpperCase() === 'MONTH' ? 'months' : 'years';
      return `(${expr.trim()} - INTERVAL '${n} ${u}')`;
    }
  );
  s = s.replace(
    /\bDATE_ADD\s*\(\s*([^,]+)\s*,\s*INTERVAL\s+(\d+)\s+(DAY|MONTH|YEAR)\s*\)/gi,
    (_, expr, n, unit) => {
      const u = unit.toUpperCase() === 'DAY' ? 'days' : unit.toUpperCase() === 'MONTH' ? 'months' : 'years';
      return `(${expr.trim()} + INTERVAL '${n} ${u}')`;
    }
  );

  s = s.replace(/(\b\w+\.)?completed\s*=\s*1\b/gi, (_, p) => `${p || ''}completed IS TRUE`);
  s = s.replace(/(\b\w+\.)?completed\s*=\s*0\b/gi, (_, p) => `COALESCE(${p || ''}completed, false) = false`);

  s = s.replace(/(\b\w+\.billable|\bbillable)\s*=\s*1\b/gi, '$1 IS TRUE');
  s = s.replace(/(\b\w+\.billable|\bbillable)\s*=\s*0\b/gi, '$1 IS FALSE');

  s = s.replace(
    /JSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(\s*([^,]+?)\s*,\s*'\$\.([^']+)'\s*\)\s*\)/gi,
    "($1::jsonb->>'$2')"
  );
  s = s.replace(
    /JSON_EXTRACT\s*\(\s*([^,]+?)\s*,\s*'\$\.([^']+)'\s*\)/gi,
    "($1::jsonb->>'$2')"
  );

  s = s.replace(/\bSET\s+(\w+\.)?is_read\s*=\s*1\b/gi, (_, p) => `SET ${p || ''}is_read = true`);
  s = s.replace(/\b(\w+\.)?is_read\s*=\s*0\b/gi, (_, p) => `COALESCE(${p || ''}is_read, false) = false`);
  s = s.replace(/\b(\w+\.)?is_read\s*=\s*1\b/gi, (_, p) => `${p || ''}is_read = true`);

  // FIND_IN_SET(needle, haystack) — comma-separated lists
  s = s.replace(
    /FIND_IN_SET\s*\(\s*\?\s*,\s*([^)]+)\)\s*>\s*0/gi,
    "(POSITION(',' || ?::text || ',' IN ',' || ($1) || ',') > 0)"
  );
  s = s.replace(
    /FIND_IN_SET\s*\(\s*([^,]+)\s*,\s*([^)]+)\)\s*>\s*0/gi,
    "(POSITION(',' || ($1)::text || ',' IN ',' || ($2) || ',') > 0)"
  );
  // Bare FIND_IN_SET (MySQL truthy integer in WHERE)
  s = s.replace(
    /FIND_IN_SET\s*\(\s*\?\s*,\s*([^)]+)\)/gi,
    "(POSITION(',' || ?::text || ',' IN ',' || ($1) || ',') > 0)"
  );
  s = s.replace(
    /FIND_IN_SET\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi,
    "(POSITION(',' || ($1)::text || ',' IN ',' || ($2) || ',') > 0)"
  );

  s = replaceMysqlUpdateJoin(s);

  return s;
}

/** MySQL `UPDATE t1 JOIN t2 SET t1.col …` → PostgreSQL `UPDATE t1 SET col … FROM t2 WHERE …`. */
function replaceMysqlUpdateJoin(sql) {
  return sql.replace(
    /UPDATE\s+(\w+)\s+(\w+)\s+INNER\s+JOIN\s+(\w+)\s+(\w+)\s+ON\s+(.+?)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/is,
    (_, t1, a1, t2, a2, onClause, setClause, whereClause) => {
      const setPg = setClause.replace(/\b\w+\./g, '');
      return `UPDATE ${t1} ${a1} SET ${setPg} FROM ${t2} ${a2} WHERE ${onClause} AND ${whereClause}`;
    }
  );
}

/** Safe cast for varchar columns that may hold non-numeric values (e.g. "/hr"). */
function safeNumericText(expr) {
  const e = expr.trim();
  // Avoid `?` in the pattern — db.js treats `?` as bind placeholders
  return `(CASE WHEN TRIM(COALESCE(${e}::text, '')) ~ '^[-]{0,1}[0-9]+(\\.[0-9]*){0,1}$' THEN TRIM(${e}::text)::numeric ELSE 0 END)`;
}

module.exports = { mysqlToPgSql, safeNumericText };
