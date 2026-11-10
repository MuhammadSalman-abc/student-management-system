const { app } = require("./server");

// Support both the CommonJS Express entrypoint and Vercel's CJS default-export
// loader used by the Services runtime.
module.exports = app;
module.exports.default = app;
