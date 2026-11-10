const http = require("node:http");
const { app } = require("./server");

// Vercel Services accepts a Node HTTP server as its entrypoint. Wrapping the
// Express app avoids its CJS-to-ESM export conversion losing the callable app.
module.exports = http.createServer(app);
