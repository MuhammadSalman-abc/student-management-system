const { app, initialize } = require("../server-old/server/server");
module.exports = async (req, res) => {
  try {
    await initialize();
    return app(req, res);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "api_initialization_failed",
      errorType: error.name || "Error",
      message: error.message,
    }));
    return res.status(503).json({ message: "StudentHub is temporarily unavailable. Check the server configuration." });
  }
};
