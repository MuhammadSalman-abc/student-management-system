const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Existing databases are migrated through the explicit index preflight command.
// Avoid Mongoose creating declared indexes implicitly during application startup.
mongoose.set("autoIndex", false);

const { createEmailOutboxWorker } = require("./services/emailOutboxWorker");
const initialize = require("./config/initialize");
// Keep model imports static so deployment tracing includes every schema file.
require("./models/User");
require("./models/Student");
require("./models/StudentInvitation");
require("./models/StudentPasswordReset");
require("./models/EmailOutbox");
require("./models/DataMigration");
require("./models/AuthRateWindow");
require("./models/CourseOffering");
require("./models/Enrollment");
require("./models/AttendanceSession");
require("./models/AttendanceMark");
require("./models/AttendanceChange");
require("./models/Assessment");
require("./models/AssessmentResult");
require("./models/AssessmentChange");
require("./models/AuditEvent");
require("./models/Assignment");
const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const academicRoutes = require("./routes/academicRoutes");

dotenv.config();

const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map((hostname) => new URL(hostname.includes("://") ? hostname : `https://${hostname}`).origin);
const deploymentHostname = process.env.NODE_ENV === "production"
  ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  : process.env.VERCEL_URL;
if (!process.env.CLIENT_APP_URL && deploymentHostname) {
  process.env.CLIENT_APP_URL = deploymentHostname.includes("://") ? deploymentHostname : `https://${deploymentHostname}`;
}

const app = express();
// Vercel's Express service invokes this app directly. Initialise lazily here so
// the same app works for both local `app.listen` and serverless requests.
app.use(async (req, res, next) => {
  try {
    await initialize({ allowedOrigins });
    return next();
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "api_initialization_failed",
      errorType: error.name || "Error",
      message: error.message,
    }));
    return res.status(503).json({
      message: "StudentHub is temporarily unavailable. Check the server configuration.",
    });
  }
});
const configuredOrigins = process.env.CLIENT_ORIGINS
  ? process.env.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedOrigins = [...new Set([...configuredOrigins, ...vercelOrigins])];
const isAllowedBrowserOrigin = (origin) => {
  if (!origin || allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const parsed = new URL(origin);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const port = Number(parsed.port);
    return parsed.origin === origin && parsed.protocol === "http:" && localHost && Number.isInteger(port) && port >= 5173 && port <= 5199;
  } catch {
    return false;
  }
};
const apiRoutes = express.Router();
apiRoutes.get("/openapi.yaml", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("application/yaml").sendFile(path.join(__dirname, "openapi.yaml"));
});
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/students", studentRoutes);
apiRoutes.use("/academics", academicRoutes);

app.disable("x-powered-by");
app.set("trust proxy", Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || 0));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients and same-origin requests; constrain browser origins.
    if (isAllowedBrowserOrigin(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Request-ID", "API-Version", "X-API-Deprecated"],
  credentials: true,
}));
app.use(express.json({ limit: "300kb" }));
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const hasBearerAuth = req.get("authorization")?.startsWith("Bearer ");
  if ((origin && !isAllowedBrowserOrigin(origin)) || fetchSite === "cross-site" || (!hasBearerAuth && !origin)) {
    return res.status(403).json({ message: "Cross-site state-changing requests are not allowed." });
  }
  return next();
});

app.get("/health/live", (req, res) => res.json({ status: "ok" }));
app.get("/health/ready", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
});
app.get("/", (req, res) => res.json({ message: "Student Management API is running" }));

app.use("/api/v1", (req, res, next) => {
  res.setHeader("API-Version", "1");
  next();
}, apiRoutes);
app.use("/api", (req, res, next) => {
  // Compatibility alias for clients that still use the original unversioned API.
  if (!req.path.startsWith("/v1/")) {
    res.setHeader("API-Version", "1");
    res.setHeader("X-API-Deprecated", "true");
  }
  next();
}, apiRoutes);

app.use("/api", (req, res) => res.status(404).json({ message: "API route not found." }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ message: "Request origin is not allowed." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body must contain valid JSON." });
  }
  console.error(JSON.stringify({
    level: "error",
    event: "request_failed",
    requestId: req.requestId,
    method: req.method,
    route: req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched",
    errorType: err.name || "Error",
  }));
  return res.status(500).json({
    message: "An unexpected server error occurred.",
    requestId: req.requestId,
  });
});

const start = async () => {
  const { emailSettings, port } = await initialize({ allowedOrigins });
  const server = app.listen(port, () => {
    console.log(`Student Management API listening on port ${port}`);
  });
  const emailOutboxWorker = emailSettings.configured ? createEmailOutboxWorker() : null;
  emailOutboxWorker?.start();

  const shutdown = async (signal) => {
    console.log(`${signal} received; closing server.`);
    const serverClosed = new Promise((resolve) => server.close(resolve));
    await emailOutboxWorker?.stop();
    await serverClosed;
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
};

if (require.main === module) {
  start().catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { app, start, initialize: () => initialize({ allowedOrigins }) };
