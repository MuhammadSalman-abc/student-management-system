const User = require("../models/User");
const Student = require("../models/Student");
const StudentInvitation = require("../models/StudentInvitation");
const StudentPasswordReset = require("../models/StudentPasswordReset");
const AuditEvent = require("../models/AuditEvent");
const mongoose = require("mongoose");
const { createHash } = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const getSessionSettings = require("../config/session");

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  displayName: user.displayName || user.name,
  email: user.email,
  role: user.role,
});

const issueToken = (user, expiresIn) => jwt.sign(
  { id: user._id.toString(), role: user.role, ver: user.tokenVersion || 0 },
  process.env.JWT_SECRET,
  { algorithm: "HS256", expiresIn }
);

const setSessionCookie = (res, user) => {
  const { jwtExpiresIn, cookieMaxAgeMs } = getSessionSettings();
  res.cookie("sms_session", issueToken(user, jwtExpiresIn), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: cookieMaxAgeMs,
  });
};

const registerUser = (req, res) => res.status(410).json({
  message: "Student self-registration has been replaced with administrator-issued invitations.",
});

const hashInvitationToken = (token) => createHash("sha256").update(token).digest("hex");

const getInvitation = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(410).json({ message: "This invitation is invalid or expired." });
  const invitation = await StudentInvitation.findOne({
    tokenHash: hashInvitationToken(token),
    usedAt: null,
    invalidatedAt: null,
    expiresAt: { $gt: new Date() },
  }).populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "name email" }).lean();
  if (!invitation?.studentId) return res.status(410).json({ message: "This invitation is invalid or expired." });
  return res.json({ student: invitation.studentId, expiresAt: invitation.expiresAt });
};

const acceptInvitation = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(410).json({ message: "This invitation is invalid or expired." });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ message: "Password must be between 12 and 128 characters." });

  const tokenHash = hashInvitationToken(token);
  const invitationExists = await StudentInvitation.exists({
    tokenHash,
    usedAt: null,
    invalidatedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!invitationExists) return res.status(410).json({ message: "This invitation is invalid or expired." });
  const passwordHash = await bcrypt.hash(password, 12);
  const session = await mongoose.startSession();
  let createdUser;
  try {
    await session.withTransaction(async () => {
      const invitation = await StudentInvitation.findOne({
        tokenHash,
        usedAt: null,
        invalidatedAt: null,
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!invitation) {
        const error = new Error("This invitation is invalid, expired, or already used.");
        error.code = "INVITATION_INVALID";
        throw error;
      }
      const student = await Student.findOne({ _id: invitation.studentId, status: { $ne: "archived" } }).session(session);
      if (!student || student.userId || await User.exists({ email: student?.email }).session(session)) {
        const error = new Error("This student record is unavailable for account activation.");
        error.code = "STUDENT_UNAVAILABLE";
        throw error;
      }
      [createdUser] = await User.create([{
        name: student.name,
        email: student.email,
        password: passwordHash,
        role: "student",
      }], { session });
      student.userId = createdUser._id;
      await student.save({ session });
      invitation.usedAt = new Date();
      await invitation.save({ session });
    });
    setSessionCookie(res, createdUser);
    return res.status(201).json({ message: "Student account activated.", user: publicUser(createdUser) });
  } catch (error) {
    if (error.code === "INVITATION_INVALID") return res.status(410).json({ message: error.message });
    if (error.code === "STUDENT_UNAVAILABLE") return res.status(409).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: "An account already exists for this student." });
    console.error("Accept student invitation failed:", error.message);
    return res.status(500).json({ message: "Unable to activate the student account." });
  } finally {
    await session.endSession();
  }
};

const inspectPasswordReset = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const body = req.body || {};
  if (Object.keys(body).some((key) => key !== "token")) return res.status(400).json({ message: "Only the reset token is accepted." });
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(410).json({ message: "This password reset link is invalid or expired." });

  try {
    const reset = await StudentPasswordReset.findOne({
      tokenHash: hashInvitationToken(token),
      usedAt: null,
      invalidatedAt: null,
      expiresAt: { $gt: new Date() },
    }).populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "name email userId" }).lean();
    if (!reset?.studentId || reset.studentId.userId?.toString() !== reset.userId.toString()) {
      return res.status(410).json({ message: "This password reset link is invalid or expired." });
    }
    const account = await User.exists({ _id: reset.userId, role: "student", active: true });
    if (!account) return res.status(410).json({ message: "This password reset link is invalid or expired." });
    return res.json({ student: { name: reset.studentId.name, email: reset.studentId.email }, expiresAt: reset.expiresAt });
  } catch (error) {
    console.error("Inspect student password reset failed:", error.message);
    return res.status(503).json({ message: "Unable to verify this password reset link right now." });
  }
};

const completePasswordReset = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const body = req.body || {};
  if (Object.keys(body).some((key) => !["token", "password"].includes(key))) {
    return res.status(400).json({ message: "Only the reset token and new password are accepted." });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(410).json({ message: "This password reset link is invalid or expired." });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ message: "Password must be between 12 and 128 characters." });

  const tokenHash = hashInvitationToken(token);
  let validReset;
  try {
    validReset = await StudentPasswordReset.exists({ tokenHash, usedAt: null, invalidatedAt: null, expiresAt: { $gt: new Date() } });
  } catch (error) {
    console.error("Check student password reset failed:", error.message);
    return res.status(503).json({ message: "Unable to reset the password right now." });
  }
  if (!validReset) return res.status(410).json({ message: "This password reset link is invalid or expired." });
  const passwordHash = await bcrypt.hash(password, 12);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const reset = await StudentPasswordReset.findOne({
        tokenHash,
        usedAt: null,
        invalidatedAt: null,
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!reset) {
        const error = new Error("This password reset link is invalid or expired.");
        error.code = "PASSWORD_RESET_INVALID";
        throw error;
      }
      const student = await Student.findOne({ _id: reset.studentId, userId: reset.userId, status: { $ne: "archived" } }).session(session);
      const user = await User.findOne({ _id: reset.userId, role: "student", active: true }).session(session);
      if (!student || !user) {
        const error = new Error("This password reset link is invalid or expired.");
        error.code = "PASSWORD_RESET_INVALID";
        throw error;
      }
      if (await bcrypt.compare(password, user.password)) {
        const error = new Error("Choose a password that differs from your current password.");
        error.code = "PASSWORD_RESET_UNCHANGED";
        throw error;
      }
      user.password = passwordHash;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save({ session });
      reset.usedAt = new Date();
      await reset.save({ session });
      await StudentPasswordReset.updateMany(
        { studentId: student._id, _id: { $ne: reset._id }, usedAt: null, invalidatedAt: null },
        { $set: { invalidatedAt: new Date() } },
        { session }
      );
      await AuditEvent.create([{
        actorId: user._id,
        eventType: "student_password_reset_completed",
        studentId: student._id,
      }], { session });
    });
    return res.json({ message: "Password reset. Sign in with your new password; previous sessions have been revoked." });
  } catch (error) {
    if (error.code === "PASSWORD_RESET_INVALID") return res.status(410).json({ message: error.message });
    if (error.code === "PASSWORD_RESET_UNCHANGED") return res.status(400).json({ message: error.message });
    console.error("Complete student password reset failed:", error.message);
    return res.status(503).json({ message: "Unable to reset the password right now." });
  } finally {
    await session.endSession();
  }
};

const loginUser = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) {
    return res.status(400).json({ message: "Please enter a valid email and password." });
  }

  try {
    const user = await User.findOne({ email });
    const passwordMatches = user && await bcrypt.compare(password, user.password);
    if (!user || !passwordMatches) {
      await req.recordAuthFailure?.();
      return res.status(401).json({ message: "Invalid email or password." });
    }
    if (user.active === false) {
      return res.status(403).json({ message: "This account is inactive. Contact your administrator." });
    }
    // The submitted role is not authorization. The account's stored role wins.
    await req.clearAuthFailures?.();
    setSessionCookie(res, user);
    return res.json({ message: "Login successful.", user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error.message);
    return res.status(500).json({ message: "Unable to complete login." });
  }
};

const getCurrentUser = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const user = await User.findById(req.user.id).select("name displayName email role active").lean();
  if (!user || user.active === false) {
    return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
  }
  return res.json({ user: publicUser(user) });
};

const updateMyProfile = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const body = req.body || {};
  if (Object.keys(body).some((key) => key !== "displayName")) {
    return res.status(400).json({ message: "Only the preferred display name can be changed here." });
  }
  if (body.displayName !== undefined && typeof body.displayName !== "string") {
    return res.status(400).json({ message: "Display name must be text." });
  }
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length > 80) return res.status(400).json({ message: "Display name must be 80 characters or fewer." });
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.active === false) return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
    user.displayName = displayName || undefined;
    await user.save();
    return res.json({ message: "Profile updated.", user: publicUser(user) });
  } catch (error) {
    console.error("Profile update failed:", error.message);
    return res.status(503).json({ message: "Unable to update your profile right now." });
  }
};

const getMyProfilePhoto = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const user = await User.findById(req.user.id).select("+profilePhoto").lean();
    if (!user?.profilePhoto?.length) return res.status(404).json({ message: "No profile photo has been uploaded." });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", user.profilePhoto.length);
    return res.status(200).send(user.profilePhoto);
  } catch (error) {
    console.error("Load profile photo failed:", error.message);
    return res.status(503).json({ message: "Unable to load your profile photo right now." });
  }
};

const updateMyProfilePhoto = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (!req.is("image/jpeg")) return res.status(415).json({ message: "Upload a resized JPEG profile photo." });
  const image = req.body;
  if (!Buffer.isBuffer(image) || image.length < 4 || image.length > 400 * 1024
    || image[0] !== 0xff || image[1] !== 0xd8 || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
    return res.status(400).json({ message: "Profile photo must be a valid JPEG file no larger than 400 KB." });
  }
  try {
    const result = await User.updateOne({ _id: req.user.id, active: true }, { $set: { profilePhoto: image } });
    if (!result.matchedCount) return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
    return res.json({ message: "Profile photo updated." });
  } catch (error) {
    console.error("Save profile photo failed:", error.message);
    return res.status(503).json({ message: "Unable to save your profile photo right now." });
  }
};

const deleteMyProfilePhoto = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const result = await User.updateOne({ _id: req.user.id, active: true }, { $unset: { profilePhoto: 1 } });
    if (!result.matchedCount) return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
    return res.json({ message: "Profile photo removed." });
  } catch (error) {
    console.error("Remove profile photo failed:", error.message);
    return res.status(503).json({ message: "Unable to remove your profile photo right now." });
  }
};

const changePassword = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || currentPassword.length > 128 || newPassword.length < 12 || newPassword.length > 128) {
    return res.status(400).json({ message: "Enter your current password and choose a new password between 12 and 128 characters." });
  }
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.active === false) return res.status(401).json({ message: "Account is unavailable. Please sign in again." });
    if (!await bcrypt.compare(currentPassword, user.password)) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: "Choose a new password that differs from your current password." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const dbSession = await mongoose.startSession();
    let updatedUser;
    try {
      await dbSession.withTransaction(async () => {
        const update = await User.updateOne(
          {
            _id: user._id,
            password: user.password,
            $or: [
              { tokenVersion: user.tokenVersion || 0 },
              { tokenVersion: { $exists: false } },
            ],
          },
          { $set: { password: passwordHash }, $inc: { tokenVersion: 1 } },
          { runValidators: true, session: dbSession }
        );
        if (!update.matchedCount) {
          const error = new Error("Your password changed in another session. Sign in again.");
          error.code = "PASSWORD_CHANGED_CONCURRENTLY";
          throw error;
        }
        await StudentPasswordReset.updateMany(
          { userId: user._id, usedAt: null, invalidatedAt: null },
          { $set: { invalidatedAt: new Date() } },
          { session: dbSession }
        );
        await AuditEvent.create([{
          actorId: user._id,
          eventType: "account_password_changed",
        }], { session: dbSession });
        updatedUser = await User.findById(user._id).session(dbSession);
      });
    } catch (error) {
      if (error.code === "PASSWORD_CHANGED_CONCURRENTLY") return res.status(409).json({ message: error.message });
      throw error;
    } finally {
      await dbSession.endSession();
    }
    setSessionCookie(res, updatedUser);
    return res.json({ message: "Password changed. Other signed-in sessions have been revoked." });
  } catch (error) {
    console.error("Password change failed:", error.message);
    return res.status(503).json({ message: "Unable to change your password right now." });
  }
};

const logoutUser = (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.clearCookie("sms_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
  });
  return res.json({ message: "Signed out." });
};

module.exports = { registerUser, getInvitation, acceptInvitation, inspectPasswordReset, completePasswordReset, loginUser, getCurrentUser, updateMyProfile, getMyProfilePhoto, updateMyProfilePhoto, deleteMyProfilePhoto, changePassword, logoutUser };
