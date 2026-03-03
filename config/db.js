// db.js
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: "casesdb.cluster-cy05fj2evp1i.us-east-1.rds.amazonaws.com",
  user: "admin",
  password: "GFiL*elWuqU5Csl1",
  database: "casesdb",
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }
  console.log("Connected to the database.");
});

module.exports = db;