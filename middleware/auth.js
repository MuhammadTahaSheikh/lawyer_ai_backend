// middleware/auth.js

module.exports = function verifyApiKey(req, res, next) {
  // Skip API-key check for DocuSeal webhook endpoint
  if (req.path === "/api/docuseal/webhook") {
    return next();
  }

  // 1) Handle CORS preflight (OPTIONS) requests directly
  if (req.method === "OPTIONS") {
    // Allow the requesting origin
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    // Permit all standard methods
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    // Expose and allow the x-api-key header
    res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
    return res.sendStatus(200);
  }

  // 2) Skip Socket.IO polling/upgrade requests
  if (req.url.startsWith("/socket.io/") || req.url === "/socket.io") {
    return next();
  }

  // 3) (Optional) If you still want your test route open, skip it:
  if (req.path === "/__test-error__") {
    return next();
  }

  // 4) Read the incoming x-api-key header
  const incomingKey = req.get("x-api-key") || "";

  if (incomingKey && incomingKey === process.env.API_KEY) {
    // Full access key — all methods allowed
    return next();
  }

  if (incomingKey && incomingKey === process.env.API_KEY_WRITE_ONLY) {
    // Write-only key — only allow POST, PUT, PATCH
    if (req.method === "GET" || req.method === "DELETE") {
      return res
        .status(403)
        .json({ error: "Forbidden: this token only allows write operations (POST, PUT, PATCH)" });
    }
    return next();
  }

  return res
    .status(401)
    .json({ error: "Unauthorized: missing or invalid API key" });
};