const express = require("express");

const {
  registerUser,
  getInvitation,
  acceptInvitation,
  inspectPasswordReset,
  completePasswordReset,
  loginUser,
  getCurrentUser,
  updateMyProfile,
  getMyProfilePhoto,
  updateMyProfilePhoto,
  deleteMyProfilePhoto,
  changePassword,
  logoutUser,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const authRateLimit = require("../middleware/authRateLimit");

const router = express.Router();

router.post("/register", registerUser);
router.post("/invitations/inspect", authRateLimit, getInvitation);
router.post("/invitations/accept", authRateLimit, acceptInvitation);
router.post("/password-resets/inspect", authRateLimit, inspectPasswordReset);
router.post("/password-resets/complete", authRateLimit, completePasswordReset);

router.post("/login", authRateLimit.login, loginUser);
router.get("/me", protect, getCurrentUser);
router.patch("/me", protect, updateMyProfile);
router.get("/me/photo", protect, getMyProfilePhoto);
router.put("/me/photo", protect, express.raw({ type: "image/jpeg", limit: "400kb" }), updateMyProfilePhoto);
router.delete("/me/photo", protect, deleteMyProfilePhoto);
router.post("/password", protect, changePassword);
router.post("/logout", logoutUser);

module.exports = router;
