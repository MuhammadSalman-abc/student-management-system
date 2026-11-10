// Keep the Express import in this Vercel entrypoint. Vercel uses it to detect
// that this service is an Express application before loading the exported app.
require("express");
const { app } = require("./server");

module.exports = app;
