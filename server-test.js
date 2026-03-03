// server.js

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();
const logger = require("./logger");

// --- App & HTTP Server Setup ---
const app = express();
const server = http.createServer(app);

// --- MANUAL CORS MIDDLEWARE ---
// This runs before any routes or body parsing.
// It ensures every preflight (OPTIONS) response includes “x-api-key” in allowed headers.
const allowedOrigins = [
  "http://localhost:3000",
  "https://localhost:3000",
  "http://localhost:3001",
  "https://localhost:3001",
  "https://localhost:3004",
  "https://localhost:3005",
  "https://localhost:3009",
  "https://cms.louislawgroup.com",
  "https://laywer-ai-git-dev-ymesadevs-projects.vercel.app"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  res.header("Access-Control-Allow-Credentials", "true");

  // If it’s a preflight request, respond immediately
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// --- Middleware ---
// JSON and URL-encoded body parsers
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("joinCase", (caseId) => {
    socket.join(`case-${caseId}`);
  });
});

// --- Static File Serving ---
app.use("/case-media", express.static(path.join(__dirname, "case-media")));
app.use("/case-documents", express.static(path.join(__dirname, "case-documents")));

// --- Route Imports ---
const casesRoutes         = require("./routes/cases");
const contactsRoutes      = require("./routes/contacts");
const eventsRoutes        = require("./routes/events");
const tasksRoutes         = require("./routes/tasks");
const customFieldsRoutes  = require("./routes/customFields");
const timeEntriesRoutes   = require("./routes/timeEntries");
const practiceAreasRoutes = require("./routes/practiceAreas");
const caseNotesRoutes     = require("./routes/caseNotes");
const eventTypesRoutes    = require("./routes/eventTypes");
const activeUsersRoutes   = require("./routes/activeUsers");
const documentsRoutes     = require("./routes/documents");
const communicationsRoutes= require("./routes/communications");
const inboundSMSRoutes    = require("./routes/inboundSMS");
const activityRoutes      = require("./routes/activity");
const caseStagesRoutes    = require("./routes/caseStages");
const columnRoutes        = require("./routes/column");
const expensesRoutes      = require("./routes/expenses");
const reports             = require("./routes/reports");
const clientRoutes        = require("./routes/client");
const company             = require("./routes/company");
const eSignRoutes         = require("./routes/eSign");

// --- Mount Routes ---
// Because the manual CORS middleware runs above, every endpoint—including /custom_fields—
// responds to preflight OPTIONS with Access-Control-Allow-Headers: "Content-Type, Authorization, x-api-key".
app.use(casesRoutes);
app.use(contactsRoutes);
app.use(eventsRoutes);
app.use(tasksRoutes);
app.use(customFieldsRoutes);
app.use(timeEntriesRoutes);
app.use(practiceAreasRoutes);
app.use(caseNotesRoutes);
app.use(eventTypesRoutes);
app.use(activeUsersRoutes);
app.use(documentsRoutes);
app.use("/cases", communicationsRoutes);
app.use(inboundSMSRoutes);
app.use(activityRoutes);
app.use(caseStagesRoutes);
app.use(columnRoutes);
app.use(expensesRoutes);
app.use(reports);
app.use(clientRoutes);
app.use(company);
app.use(eSignRoutes);

// --- Quick Test Route ---
app.get("/__test-error__", (req, res, next) => {
  next(new Error("💥 Intentional test error"));
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  logger.error("Unhandled exception", {
    path: req.originalUrl,
    method: req.method,
    body: req.body,
    headers: req.headers,
    message: err.message,
    stack: err.stack
  });
  res.status(500).json({ error: "Internal server error" });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});