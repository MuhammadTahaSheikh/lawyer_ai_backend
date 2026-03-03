// db.js
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com',
  user:               process.env.DB_USER     || 'admin',
  password:           process.env.DB_PASSWORD || 'GFiL*elWuqU5Csl1',
  database:           process.env.DB_NAME     || 'casesdb',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  // Force all dates to Eastern (UTC−04:00) and return as strings
  timezone:          '-04:00',
  dateStrings:       true

});

// 1) leave the built-in callback `pool.query(sql, cb)` intact
// 2) export a promise interface under `.promise()`, so you can still use async/await
pool.promisePool = pool.promise();  

// Startup check
pool.getConnection((err, conn) => {
  if (err) {
    console.error('⛔️ MySQL connection error:', err);
    process.exit(1);
  }
  console.log('✅ MySQL connected:', pool.config.connectionConfig.host);
  conn.release();
});

// Optional: listen for unexpected errors
pool.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

module.exports = pool;