// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const logger = require("./logger");

// ─── 1) App & HTTP Server Setup ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── 2) Global CORS Preflight Handler ────────────────────────────────────────
// app.use((req, res, next) => {
//   if (req.method === "OPTIONS") {
//     res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
//     res.header(
//       "Access-Control-Allow-Methods",
//       "GET,POST,PUT,PATCH,DELETE,OPTIONS"
//     );
//     res.header(
//       "Access-Control-Allow-Headers",
//       "Content-Type, x-api-key, Authorization, x-user-uid, x-folder-name"
//     );
//     res.header("Access-Control-Allow-Credentials", "true");
//     return res.sendStatus(200);
//   }
//   next();
// });
app.use((req, res, next) => {
  // replace any "%" not followed by 2 hex chars with "%25"
  const fixedUrl = req.url.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  if (fixedUrl !== req.url) req.url = fixedUrl;
  next();
});
// ─── 3) CORS Configuration ───────────────────────────────────────────────────
const allowedOrigins = [
  "https://dev.louislawgroup.com",
  "https://laywer-ai.vercel.app",
  "https://laywer-3z4qxflgd-ymesadevs-projects.vercel.app",
  "https://external-applications.louislawgroup.com",
  "https://cms.louislawgroup.com",
  "https://laywer-ai-git-dev-ymesadevs-projects.vercel.app",
  "http://localhost:3000",
  "https://localhost:3000",
  "http://localhost:3001",
  "https://localhost:3001",
  "https://localhost:3003",
  "https://localhost:3004",
];

const corsOptions = {
  origin: (incomingOrigin, callback) => {
    if (!incomingOrigin || allowedOrigins.includes(incomingOrigin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "x-api-key",
    "Authorization",
    "x-user-uid",
    "x-folder-name",
  ],
  credentials: true,
};

// Handle OPTIONS preflight once:
app.options("*", cors(corsOptions));

// ─── 4) Raw Body Middleware for WOPI (must be BEFORE JSON parsers) ───────────
app.use(
  "/wopi/files/:fileId/contents",
  express.raw({ type: "*/*", limit: "200mb" })
);

// ─── 5) Body Parsers ─────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// ─── 6) API Key Verification ────────────────────────────────────────────────
const verifyApiKey = require("./middleware/auth");

// ✅ UPDATED: allow ALL /wopi/ routes without API key (discovery + files)
app.use((req, res, next) => {
  // ✅ ALWAYS allow CORS preflight requests
  if (req.method === "OPTIONS") return next();
  // Allow all WOPI endpoints to be called by OnlyOffice/browser without x-api-key
  if (req.path.startsWith("/wopi/")) return next();

  // Allow public case-documents GETs (for direct file access)
  if (req.method === "GET" && req.path.startsWith("/case-documents/"))
    return next();

  // Everything else requires an API key
  return verifyApiKey(req, res, next);
});

// ─── 7) Socket.IO Setup ─────────────────────────────────────────────────────
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
app.set("io", io);

io.on("connection", (socket) => {
  console.log(`🟢 Socket connected: ${socket.id}`);
  socket.on("joinCase", (caseId) => {
    const roomName = `case-${caseId}`;
    socket.join(roomName);
    console.log(`   🔑 Socket ${socket.id} joined room "${roomName}"`);
  });
  socket.on("disconnect", () => {
    console.log(`⚪️ Socket disconnected: ${socket.id}`);
  });
});

// ─── 8) Static File Serving ──────────────────────────────────────────────────
app.use("/case-media", express.static(path.join(__dirname, "case-media")));
app.use("/case-documents", express.static(path.join(__dirname, "case-documents")));

// ─── 9) Route Imports ────────────────────────────────────────────────────────
const casesRoutes = require("./routes/cases");
const contactsRoutes = require("./routes/contacts");
const eventsRoutes = require("./routes/events");
const tasksRoutes = require("./routes/tasks");
const customFieldsRoutes = require("./routes/customFields");
const timeEntriesRoutes = require("./routes/timeEntries");
const practiceAreasRoutes = require("./routes/practiceAreas");
const caseNotesRoutes = require("./routes/caseNotes");
const eventTypesRoutes = require("./routes/eventTypes");
const activeUsersRoutes = require("./routes/activeUsers");
const documentsRoutes = require("./routes/documents");
const communicationsRoutes = require("./routes/communications");
const inboundSMSRoutes = require("./routes/inboundSMS");
const activityRoutes = require("./routes/activity");
const caseStagesRoutes = require("./routes/caseStages");
const columnRoutes = require("./routes/column");
const expensesRoutes = require("./routes/expenses");
const reports = require("./routes/reports");
const clientRoutes = require("./routes/client");
const companyRoutes = require("./routes/company");
const eSignRoutes = require("./routes/eSign");
const automationsRouter = require("./routes/automations");
const caseLinksRoutes = require("./routes/caseLinks");
const wopiRouter = require("./routes/wopi");
const initialDisclosuresRoutes = require("./routes/initialDisclosures");

// ─── 10) Mount Routes ────────────────────────────────────────────────────────
app.use("/cases", communicationsRoutes);
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
app.use(inboundSMSRoutes);
app.use(activityRoutes);
app.use(caseStagesRoutes);
app.use(columnRoutes);
app.use(expensesRoutes);
app.use(reports);
app.use(clientRoutes);
app.use(companyRoutes);
app.use("/api/docuseal", eSignRoutes);
app.use("/automations", automationsRouter);
app.use(caseLinksRoutes);
app.use("/wopi", wopiRouter);
app.use(initialDisclosuresRoutes);

// ─── 11) Quick Test Route ────────────────────────────────────────────────────
app.get("/__test-error__", (req, res, next) => {
  next(new Error("💥 Intentional test error"));
});

// ─── 12) Global Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error("Unhandled exception", {
    path: req.originalUrl,
    method: req.method,
    body: req.body,
    headers: req.headers,
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: "Internal server error" });
});

// ─── 13) Start Server ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


