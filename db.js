// db.js — PostgreSQL (Supabase) with a mysql2-compatible API for existing routes.
const { Pool } = require('pg');
const { mysqlToPgSql } = require('./lib/sqlPgCompat');
require('dotenv').config();

function buildPoolConfig() {
  const connectionString =
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL;

  if (connectionString) {
    return {
      connectionString,
      max: Number(process.env.DB_POOL_SIZE) || 10,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
    max: Number(process.env.DB_POOL_SIZE) || 10,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  };
}

/** Convert `?` placeholders to `$1`, `$2`, … (expands `IN (?)` arrays like mysql2). */
function toPgPlaceholders(sql, params = []) {
  const translated = mysqlToPgSql(sql);
  let paramIdx = 0;
  let pgIdx = 0;
  const values = [];
  let text = '';
  let i = 0;

  const nextPlaceholder = () => {
    const val = params[paramIdx++];
    if (Array.isArray(val)) {
      if (val.length === 0) return 'NULL';
      // mysql2 bulk insert: VALUES ? with [[col1, col2], [col1, col2], ...]
      if (Array.isArray(val[0])) {
        return val
          .map((row) => {
            const cells = row.map((cell) => {
              values.push(cell);
              return `$${++pgIdx}`;
            });
            return `(${cells.join(', ')})`;
          })
          .join(', ');
      }
      return val
        .map((item) => {
          values.push(item);
          return `$${++pgIdx}`;
        })
        .join(', ');
    }
    values.push(val);
    return `$${++pgIdx}`;
  };

  while (i < translated.length) {
    const ch = translated[i];
    if (ch === "'") {
      text += ch;
      i += 1;
      while (i < translated.length) {
        text += translated[i];
        if (translated[i] === "'" && translated[i + 1] === "'") {
          text += translated[++i];
        } else if (translated[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '?') {
      text += nextPlaceholder();
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }

  return { text, values };
}

function pickInsertId(row) {
  if (!row || typeof row !== 'object') return 0;
  if (row.id != null) return row.id;
  for (const key of Object.keys(row)) {
    if (/_id$/i.test(key) && (typeof row[key] === 'number' || typeof row[key] === 'string')) {
      return row[key];
    }
  }
  return 0;
}

function wrapPgResult(pgResult, sql) {
  const fields = pgResult.fields;
  const trimmed = sql.trim();
  const isModifying = /^(INSERT|UPDATE|DELETE|REPLACE)/i.test(trimmed);

  if (isModifying) {
    const header = {
      affectedRows: pgResult.rowCount ?? 0,
      insertId: pickInsertId(pgResult.rows?.[0]),
      warningStatus: 0,
    };
    return [header, fields];
  }
  return [pgResult.rows, fields];
}

function appendReturning(sql) {
  const s = sql.trim();
  if (!/^INSERT\b/i.test(s) || /\bRETURNING\b/i.test(s)) return sql;
  return s.replace(/;\s*$/, '') + ' RETURNING *';
}

function runPgQuery(client, sql, params = []) {
  const q = appendReturning(sql);
  const { text, values } = toPgPlaceholders(q, params);
  return client.query(text, values).then((pgResult) => wrapPgResult(pgResult, sql));
}

function createPgConnection(client) {
  const tx = (command) => (cb) => {
    const run = client.query(command);
    if (typeof cb === 'function') {
      run.then(() => cb(null)).catch((err) => cb(err));
      return;
    }
    return run.then(() => undefined);
  };

  return {
    query(sql, params, cb2) {
      if (typeof params === 'function') {
        cb2 = params;
        params = [];
      }
      const run = runPgQuery(client, sql, params);
      if (cb2) {
        run
          .then((wrapped) => cb2(null, wrapped[0], wrapped[1]))
          .catch((err) => cb2(err));
        return;
      }
      return run;
    },
    beginTransaction: tx('BEGIN'),
    commit: tx('COMMIT'),
    rollback: tx('ROLLBACK'),
    release: () => client.release(),
  };
}

class PromisePool {
  constructor(pool) {
    this._pool = pool;
  }

  async execute(sql, params) {
    const q = appendReturning(sql);
    const { text, values } = toPgPlaceholders(q, params);
    const pgResult = await this._pool.query(text, values);
    return wrapPgResult(pgResult, sql);
  }

  query(sql, params) {
    return this.execute(sql, params);
  }

  async getConnection() {
    const client = await this._pool.connect();
    return createPgConnection(client);
  }
}

const pgPool = new Pool(buildPoolConfig());
const promisePool = new PromisePool(pgPool);

function escapeLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const pool = {
  promisePool,
  promise: () => promisePool,
  escape: escapeLiteral,

  query(sql, params, cb) {
    if (typeof params === 'function') {
      cb = params;
      params = [];
    }
    const q = appendReturning(sql);
    const { text, values } = toPgPlaceholders(q, params);
    pgPool
      .query(text, values)
      .then((pgResult) => {
        const [result] = wrapPgResult(pgResult, sql);
        if (cb) cb(null, result, pgResult.fields);
      })
      .catch((err) => {
        if (cb) cb(err);
      });
  },

  getConnection(cb) {
    pgPool
      .connect()
      .then((client) => cb(null, createPgConnection(client)))
      .catch((err) => cb(err));
  },

  on() {},

  config: {
    connectionConfig: {
      host:
        process.env.DB_HOST ||
        (process.env.SUPABASE_DB_URL ? 'supabase' : 'localhost'),
    },
  },
};

pgPool
  .query('SELECT 1 AS ok')
  .then(() => {
    const label = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
      ? 'Supabase PostgreSQL'
      : 'PostgreSQL';
    console.log(`✅ ${label} connected`);
  })
  .catch((err) => {
    console.error('⛔️ PostgreSQL connection error:', err.message);
    process.exit(1);
  });

pgPool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

module.exports = pool;
