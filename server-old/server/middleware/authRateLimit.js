const { createHmac } = require("node:crypto");
const AuthRateWindow = require("../models/AuthRateWindow");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const keyFor = (req, scope) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return createHmac("sha256", process.env.JWT_SECRET).update(`${scope}:${ip}`).digest("hex");
};

const increment = async (key, now, { upsert = true } = {}) => {
  const expiresAt = new Date(now.getTime() + WINDOW_MS);
  return AuthRateWindow.findOneAndUpdate({ key }, [{
    $set: {
      count: { $cond: [{ $gt: ["$resetAt", now] }, { $add: ["$count", 1] }, 1] },
      resetAt: { $cond: [{ $gt: ["$resetAt", now] }, "$resetAt", expiresAt] },
    },
  }], { returnDocument: "after", upsert, updatePipeline: true }).lean();
};

const rateLimit = ({ failedLogin = false } = {}) => async (req, res, next) => {
  try {
    const now = new Date();
    const requestKey = keyFor(req, "auth-request");
    const requestWindow = await increment(requestKey, now);
    const resetSeconds = Math.max(1, Math.ceil((requestWindow.resetAt.getTime() - Date.now()) / 1000));
    res.setHeader("RateLimit-Limit", String(MAX_ATTEMPTS));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, MAX_ATTEMPTS - requestWindow.count)));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    if (requestWindow.count > MAX_ATTEMPTS) {
      res.setHeader("Retry-After", String(resetSeconds));
      return res.status(429).json({ message: "Too many authentication attempts. Try again later." });
    }

    if (failedLogin) {
      const loginKey = keyFor(req, "failed-login");
      const failedWindow = await AuthRateWindow.findOne({ key: loginKey }).lean();
      if (failedWindow && failedWindow.resetAt > now && failedWindow.count >= MAX_ATTEMPTS) {
        const retryAfter = Math.max(1, Math.ceil((failedWindow.resetAt.getTime() - now.getTime()) / 1000));
        res.setHeader("RateLimit-Remaining", "0");
        res.setHeader("RateLimit-Reset", String(retryAfter));
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({ message: "Too many authentication attempts. Try again later." });
      }

      req.recordAuthFailure = async () => {
        const failedAt = new Date();
        try {
          // Only update a window observed by this request; a duplicate-key race
          // on first insert is retried as an ordinary atomic increment.
          const updated = await AuthRateWindow.findOneAndUpdate({ key: loginKey }, [{
            $set: {
              count: { $cond: [{ $gt: ["$resetAt", failedAt] }, { $add: ["$count", 1] }, 1] },
              resetAt: { $cond: [{ $gt: ["$resetAt", failedAt] }, "$resetAt", new Date(failedAt.getTime() + WINDOW_MS)] },
            },
          }], { returnDocument: "after", updatePipeline: true }).lean();
          const counted = updated || await increment(loginKey, failedAt);
          res.setHeader("RateLimit-Remaining", String(Math.max(0, MAX_ATTEMPTS - counted.count)));
          res.setHeader("RateLimit-Reset", String(Math.max(1, Math.ceil((counted.resetAt.getTime() - Date.now()) / 1000))));
        } catch (error) {
          if (error.code !== 11000) throw error;
          const counted = await increment(loginKey, failedAt);
          res.setHeader("RateLimit-Remaining", String(Math.max(0, MAX_ATTEMPTS - counted.count)));
          res.setHeader("RateLimit-Reset", String(Math.max(1, Math.ceil((counted.resetAt.getTime() - Date.now()) / 1000))));
        }
      };
      req.clearAuthFailures = async () => AuthRateWindow.deleteOne({ key: loginKey });
    }

    return next();
  } catch (error) {
    console.error("Authentication rate limiter failed:", error.message);
    return res.status(503).json({ message: "Authentication is temporarily unavailable. Please try again shortly." });
  }
};

const authRateLimit = rateLimit();
authRateLimit.login = rateLimit({ failedLogin: true });

module.exports = authRateLimit;
