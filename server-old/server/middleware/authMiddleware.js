const jwt = require("jsonwebtoken");
const User = require("../models/User");

const readSessionCookie = (req) => {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith("sms_session="));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice("sms_session=".length));
  } catch {
    return "";
  }
};


// =====================================
// PROTECT ROUTE
// =====================================

const protect = async (req, res, next) => {
  try {

    const authHeader =
      req.headers.authorization;

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : readSessionCookie(req);
    if (!token) {
      return res.status(401).json({ message: "Not authorized. Please sign in." });
    }


    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] }
    );


    const account = await User.findById(decoded.id).select("_id role active email tokenVersion").lean();
    if (!account || account.active === false) {
      return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
    }
    if ((decoded.ver ?? 0) !== (account.tokenVersion ?? 0)) {
      return res.status(401).json({ message: "This session has been revoked. Please sign in again." });
    }
    res.setHeader("Cache-Control", "no-store, private");

    // The database remains authoritative if an account role is changed.
    req.user = { id: account._id.toString(), role: account.role, email: account.email };


    next();

  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) {
      return res.status(401).json({ message: "Invalid or expired session. Please sign in again." });
    }
    console.error("Session verification failed:", error.message);
    return res.status(503).json({ message: "Authentication is temporarily unavailable. Please try again shortly." });

  }
};


// =====================================
// ADMIN ONLY
// =====================================

const adminOnly = (
  req,
  res,
  next
) => {

  if (
    !req.user ||
    req.user.role !== "admin"
  ) {
    return res.status(403).json({
      message:
        "Access denied. Admin only.",
    });
  }

  next();
};


// =====================================
// STUDENT ONLY
// =====================================

const studentOnly = (
  req,
  res,
  next
) => {

  if (
    !req.user ||
    req.user.role !== "student"
  ) {
    return res.status(403).json({
      message:
        "Access denied. Student only.",
    });
  }

  next();
};


module.exports = {
  protect,
  adminOnly,
  studentOnly,
};
