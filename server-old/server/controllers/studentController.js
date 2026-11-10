const mongoose = require("mongoose");
const { createHash, randomBytes } = require("node:crypto");
const Student = require("../models/Student");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const CourseOffering = require("../models/CourseOffering");
const StudentInvitation = require("../models/StudentInvitation");
const StudentPasswordReset = require("../models/StudentPasswordReset");
const AuditEvent = require("../models/AuditEvent");
const getEmailSettings = require("../config/emailSettings");
const { encryptPayload } = require("../services/emailOutboxCrypto");
const EmailOutbox = require("../models/EmailOutbox");
const { parsePagination } = require("../utils/pagination");

const editableFields = ["name", "email", "studentNumber", "course", "batch", "attendance", "assignmentScore", "finalScore"];
const numericFields = ["attendance", "assignmentScore", "finalScore"];
const isStudentNumberDuplicate = (error) => Boolean(error.keyPattern?.studentNumber || error.message?.includes("student_number_unique"));
const normalizeStudentInput = (input, { partial = false } = {}) => {
  const data = input || {};
  const keys = Object.keys(data);
  const unknown = keys.filter((key) => !editableFields.includes(key));
  if (unknown.length) return { error: `Unsupported field: ${unknown[0]}` };
  if (!partial) {
    const requiredFields = ["name", "email"];
    const missing = requiredFields.filter((key) => data[key] === undefined || data[key] === null || data[key] === "");
    if (missing.length) return { error: `Please provide: ${missing.join(", ")}.` };
  } else if (keys.length === 0) {
    return { error: "Provide at least one field to update." };
  }

  const value = {};
  for (const field of keys) {
    if (["course", "batch"].includes(field) && typeof data[field] === "string" && !data[field].trim()) {
      value[field] = undefined;
      continue;
    }
    if (["name", "course", "batch"].includes(field)) {
      if (typeof data[field] !== "string" || !data[field].trim() || data[field].trim().length > 120) {
        return { error: `${field} must be a non-empty string of 120 characters or fewer.` };
      }
      value[field] = data[field].trim();
    } else if (field === "email") {
      if (typeof data.email !== "string" || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
        return { error: "Enter a valid email address." };
      }
      value.email = data.email.trim().toLowerCase();
    } else if (field === "studentNumber") {
      if (typeof data.studentNumber !== "string" || data.studentNumber.trim().length > 40 || /\s/.test(data.studentNumber.trim())) {
        return { error: "Student number must be 40 characters or fewer and cannot contain spaces." };
      }
      value.studentNumber = data.studentNumber.trim().toUpperCase() || undefined;
    } else if (numericFields.includes(field)) {
      if (data[field] === undefined || data[field] === null || (typeof data[field] === "string" && !data[field].trim())) {
        value[field] = undefined;
        continue;
      }
      if (typeof data[field] === "string" && data[field].trim().length > 24) {
        return { error: `${field} must be a number between 0 and 100.` };
      }
      const number = Number(data[field]);
      if (!Number.isFinite(number) || number < 0 || number > 100) {
        return { error: `${field} must be a number between 0 and 100.` };
      }
      value[field] = number;
    }
  }
  return { value };
};

const getStudents = async (req, res) => {
  try {
    const pagination = parsePagination(req.query, { defaultLimit: 5, maxLimit: 50 });
    if (pagination.error) return res.status(400).json({ message: pagination.error });
    const { page, limit, offset } = pagination;
    if (req.query.status !== undefined && (typeof req.query.status !== "string" || !["active", "archived", "all"].includes(req.query.status))) {
      return res.status(400).json({ message: "Status must be active, archived, or all." });
    }
    if (req.query.search !== undefined && typeof req.query.search !== "string") {
      return res.status(400).json({ message: "Search must be a single text value." });
    }
    if (req.query.course !== undefined && typeof req.query.course !== "string") {
      return res.status(400).json({ message: "Course must be a single text value." });
    }
    if (typeof req.query.search === "string" && req.query.search.length > 100) {
      return res.status(400).json({ message: "Search must be 100 characters or fewer." });
    }
    if (typeof req.query.course === "string" && req.query.course.length > 120) {
      return res.status(400).json({ message: "Course must be 120 characters or fewer." });
    }
    if (req.query.sort !== undefined && (typeof req.query.sort !== "string" || !["name", "attendance"].includes(req.query.sort))) {
      return res.status(400).json({ message: "Sort must be name or attendance." });
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
    const sortFields = { name: { name: 1, _id: 1 }, attendance: { attendance: -1, _id: 1 } };
    const sort = sortFields[req.query.sort] || sortFields.name;
    const requestedStatus = req.query.status || "active";
    const filter = requestedStatus === "archived" ? { status: "archived" } : requestedStatus === "all" ? {} : { status: { $ne: "archived" } };
    if (course) filter.course = course;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { studentNumber: { $regex: escaped, $options: "i" } },
        { course: { $regex: escaped, $options: "i" } },
        { batch: { $regex: escaped, $options: "i" } },
      ];
    }
    const [totalStudents, students, availableCourses] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter).sort(sort).skip(offset).limit(limit).lean(),
      Student.distinct("course", requestedStatus === "archived" ? { status: "archived" } : { status: { $ne: "archived" } }),
    ]);
    const studentIds = students.map((student) => student._id);
    const studentEmails = students.map((student) => student.email);
    const linkedUserIds = students.map((student) => student.userId).filter(Boolean);
    const [accounts, linkedAccounts, invitations] = studentIds.length ? await Promise.all([
      User.find({ email: { $in: studentEmails } }).select("email role active").lean(),
      linkedUserIds.length ? User.find({ _id: { $in: linkedUserIds } }).select("role active").lean() : Promise.resolve([]),
      StudentInvitation.aggregate([
        { $match: { studentId: { $in: studentIds } } },
        { $sort: { createdAt: -1 } },
        { $group: {
          _id: "$studentId",
          expiresAt: { $first: "$expiresAt" },
          deliveryStatus: { $first: "$deliveryStatus" },
          usedAt: { $first: "$usedAt" },
          invalidatedAt: { $first: "$invalidatedAt" },
        } },
      ]),
    ]) : [[], [], []];
    const accountsByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account]));
    const linkedAccountsById = new Map(linkedAccounts.map((account) => [String(account._id), account]));
    const latestInvitations = new Map();
    for (const invitation of invitations) {
      latestInvitations.set(String(invitation._id), invitation);
    }
    const now = Date.now();
    const studentsWithAccountStatus = students.map((student) => {
      const latestInvitation = latestInvitations.get(String(student._id));
      const existingAccount = accountsByEmail.get(student.email.toLowerCase());
      const linkedAccount = student.userId ? linkedAccountsById.get(String(student.userId)) : null;
      let accountStatus = "not_invited";
      if (student.userId && linkedAccount?.role === "student" && linkedAccount.active === false) accountStatus = "account_disabled";
      else if (student.userId && linkedAccount?.role === "student") accountStatus = "account_linked";
      else if (student.userId) accountStatus = "account_link_broken";
      else if (existingAccount?.role === "student" && existingAccount.active === false) accountStatus = "account_disabled";
      else if (existingAccount?.role === "student") accountStatus = "account_linked";
      else if (existingAccount) accountStatus = "account_conflict";
      else if (latestInvitation?.usedAt) accountStatus = "account_link_broken";
      else if (latestInvitation?.invalidatedAt) accountStatus = "link_replaced";
      else if (latestInvitation && new Date(latestInvitation.expiresAt).getTime() <= now) accountStatus = "invitation_expired";
      else if (latestInvitation) accountStatus = "invitation_pending";
      return { ...student, accountStatus, invitationEmailStatus: latestInvitation?.deliveryStatus || null };
    });
    return res.json({
      students: studentsWithAccountStatus,
      availableCourses: availableCourses.filter(Boolean).sort((a, b) => a.localeCompare(b)),
      pagination: { currentPage: page, totalPages: Math.ceil(totalStudents / limit), totalStudents, limit },
    });
  } catch (error) {
    console.error("List students failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch students." });
  }
};

const getStudent = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ message: "Student not found." });
    return res.json(student);
  } catch (error) {
    console.error("Get student failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch student." });
  }
};

const createStudent = async (req, res) => {
  const normalized = normalizeStudentInput(req.body);
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const session = await mongoose.startSession();
  let student;
  try {
    await session.withTransaction(async () => {
      if (await User.exists({ email: normalized.value.email }).session(session)) {
        const error = new Error("An account with this email already exists.");
        error.code = "STUDENT_EMAIL_CONFLICT";
        throw error;
      }
      student = await new Student(normalized.value).save({ session });
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "student_created",
        studentId: student._id,
      }], { session });
    });
    return res.status(201).json({ message: "Student added successfully.", student });
  } catch (error) {
    if (error.code === "STUDENT_EMAIL_CONFLICT") return res.status(409).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: isStudentNumberDuplicate(error) ? "This student number is already assigned." : "A student with this email already exists." });
    if (error.name === "ValidationError") return res.status(400).json({ message: "Student data is invalid." });
    if (error.code === 20 && /transaction numbers are only allowed/i.test(error.message || "")) {
      console.error("Create student requires MongoDB replica-set transactions:", error.message);
      return res.status(503).json({ message: "MongoDB transactions are unavailable. Configure MongoDB as a replica set (rs0), then restart the API." });
    }
    console.error("Create student failed:", error.message);
    return res.status(500).json({ message: "Failed to add student." });
  } finally {
    await session.endSession();
  }
};

const importStudents = async (req, res) => {
  const body = req.body || {};
  if (Object.keys(body).some((key) => key !== "students")) return res.status(400).json({ message: "Only the students field is accepted." });
  if (!Array.isArray(body.students) || body.students.length < 1 || body.students.length > 100) {
    return res.status(400).json({ message: "Import between 1 and 100 student records at a time." });
  }

  const normalizedRows = [];
  const seenEmails = new Map();
  const seenStudentNumbers = new Map();
  const rowErrors = [];
  body.students.forEach((row, index) => {
    const normalized = normalizeStudentInput(row);
    if (normalized.error) {
      if (rowErrors.length < 20) rowErrors.push(`Row ${index + 2}: ${normalized.error}`);
      return;
    }
    const email = normalized.value.email;
    if (seenEmails.has(email)) {
      if (rowErrors.length < 20) rowErrors.push(`Rows ${seenEmails.get(email) + 2} and ${index + 2}: duplicate email address.`);
      return;
    }
    seenEmails.set(email, index);
    const { studentNumber } = normalized.value;
    if (studentNumber && seenStudentNumbers.has(studentNumber)) {
      if (rowErrors.length < 20) rowErrors.push(`Rows ${seenStudentNumbers.get(studentNumber) + 2} and ${index + 2}: duplicate student number.`);
      return;
    }
    if (studentNumber) seenStudentNumbers.set(studentNumber, index);
    normalizedRows.push(normalized.value);
  });
  if (rowErrors.length) return res.status(400).json({ message: "Correct the CSV rows and import again.", errors: rowErrors });

  const emails = normalizedRows.map((student) => student.email);
  const studentNumbers = normalizedRows.map((student) => student.studentNumber).filter(Boolean);
  const session = await mongoose.startSession();
  let createdCount = 0;
  try {
    await session.withTransaction(async () => {
      const existingStudent = await Student.exists({ email: { $in: emails } }).session(session);
      const existingAccount = await User.exists({ email: { $in: emails } }).session(session);
      const existingStudentNumber = studentNumbers.length
        ? await Student.exists({ studentNumber: { $in: studentNumbers } }).session(session)
        : null;
      if (existingStudent || existingAccount || existingStudentNumber) {
        const error = new Error(existingStudentNumber
          ? "One or more student numbers are already assigned."
          : "One or more email addresses already belong to a student or account.");
        error.code = "IMPORT_EMAIL_CONFLICT";
        throw error;
      }
      const created = await Student.insertMany(normalizedRows, { session, ordered: true });
      createdCount = created.length;
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "students_imported",
        rowCount: createdCount,
      }], { session });
    });
    return res.status(201).json({ message: `${createdCount} student records imported.`, importedCount: createdCount });
  } catch (error) {
    if (error.code === "IMPORT_EMAIL_CONFLICT" || error.code === 11000) {
      const message = error.code === "IMPORT_EMAIL_CONFLICT"
        ? error.message
        : isStudentNumberDuplicate(error)
          ? "A student number was assigned by another request. No import records were saved; reload and retry."
          : "An email address was added by another request. No import records were saved; reload and retry.";
      return res.status(409).json({ message });
    }
    if (error.name === "ValidationError" || error.name === "BulkWriteError") return res.status(400).json({ message: "One or more student records are invalid. No import records were saved." });
    console.error("Import students failed:", error.message);
    return res.status(500).json({ message: "Unable to import student records." });
  } finally {
    await session.endSession();
  }
};

const createStudentInvitation = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const clientAppUrl = process.env.CLIENT_APP_URL;
  if (!clientAppUrl) return res.status(503).json({ message: "Student invitation delivery is not configured." });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const link = new URL(clientAppUrl);
  link.hash = `invite=${token}`;
  const session = await mongoose.startSession();
  let invitation;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: { $ne: "archived" } }).select("+lifecycleLockVersion").session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "STUDENT_NOT_FOUND";
        throw error;
      }
      student.lifecycleLockVersion = (student.lifecycleLockVersion || 0) + 1;
      await student.save({ session });
      if (student.userId || await User.exists({ email: student.email, role: "student" }).session(session)) {
        const error = new Error("This student already has an account.");
        error.code = "ACCOUNT_EXISTS";
        throw error;
      }
      await StudentInvitation.updateMany(
        { studentId: student._id, usedAt: null, invalidatedAt: null },
        { $set: { invalidatedAt: now } },
        { session }
      );
      invitation = new StudentInvitation({
        studentId: student._id,
        tokenHash,
        invitedBy: req.user.id,
        expiresAt,
      });
      await invitation.save({ session });
      if (getEmailSettings().configured) {
        const outboxRecord = new EmailOutbox({
          messageType: "invitation",
          studentId: student._id,
          invitationId: invitation._id,
          expiresAt,
        });
        Object.assign(outboxRecord, encryptPayload({ recipient: student.email, studentName: student.name, link: link.toString(), expiresAt }, outboxRecord._id, "invitation"));
        await outboxRecord.save({ session });
      }
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "student_invitation_created",
        studentId: student._id,
      }], { session });
    });
    const delivery = getEmailSettings().configured ? { status: "queued" } : { status: "not_configured" };
    if (!getEmailSettings().configured) await StudentInvitation.updateOne({ _id: invitation._id }, { $set: { deliveryStatus: "not_configured" } });
    return res.status(201).json({
      message: delivery.status === "queued"
        ? "Student invitation created and activation email queued for delivery."
        : "Student invitation created. SMTP is not configured; share the one-time link through the approved channel.",
      invitation: { link: link.toString(), expiresAt },
      delivery,
    });
  } catch (error) {
    if (error.code === "STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "ACCOUNT_EXISTS") return res.status(409).json({ message: error.message });
    console.error("Create student invitation failed:", error.message);
    return res.status(500).json({ message: "Unable to create student invitation." });
  } finally {
    await session.endSession();
  }
};

const createStudentPasswordReset = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  if (Object.keys(req.body || {}).length) return res.status(400).json({ message: "No request fields are accepted." });
  const clientAppUrl = process.env.CLIENT_APP_URL;
  if (!clientAppUrl) return res.status(503).json({ message: "Student password reset is not configured." });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const link = new URL(clientAppUrl);
  link.hash = `reset=${token}`;
  const session = await mongoose.startSession();
  let resetRecordId;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: { $ne: "archived" } })
        .select("+lifecycleLockVersion")
        .session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "STUDENT_NOT_FOUND";
        throw error;
      }
      const account = student.userId
        ? await User.findOne({ _id: student.userId, role: "student", active: true }).session(session)
        : await User.findOne({ email: student.email, role: "student", active: true }).session(session);
      if (!account) {
        const error = new Error("An active linked student account is required before issuing a password reset link.");
        error.code = "ACTIVE_ACCOUNT_NOT_FOUND";
        throw error;
      }
      if (student.userId && student.userId.toString() !== account._id.toString()) {
        const error = new Error("The student account link is invalid. Repair it before issuing a reset link.");
        error.code = "ACCOUNT_LINK_INVALID";
        throw error;
      }

      if (!student.userId) student.userId = account._id;
      student.lifecycleLockVersion = (student.lifecycleLockVersion || 0) + 1;
      await student.save({ session });
      await StudentPasswordReset.updateMany(
        { studentId: student._id, usedAt: null, invalidatedAt: null },
        { $set: { invalidatedAt: now } },
        { session }
      );
      const [resetRecord] = await StudentPasswordReset.create([{
        studentId: student._id,
        userId: account._id,
        tokenHash,
        issuedBy: req.user.id,
        expiresAt,
      }], { session });
      resetRecordId = resetRecord._id;
      if (getEmailSettings().configured) {
        const outboxRecord = new EmailOutbox({
          messageType: "password_reset",
          studentId: student._id,
          passwordResetId: resetRecord._id,
          expiresAt,
        });
        Object.assign(outboxRecord, encryptPayload({ recipient: account.email, studentName: student.name, link: link.toString(), expiresAt }, outboxRecord._id, "password_reset"));
        await outboxRecord.save({ session });
      }
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "student_password_reset_issued",
        studentId: student._id,
      }], { session });
    });
    const delivery = getEmailSettings().configured ? { status: "queued" } : { status: "not_configured" };
    if (!getEmailSettings().configured) await StudentPasswordReset.updateOne({ _id: resetRecordId }, { $set: { deliveryStatus: "not_configured" } });
    return res.status(201).json({
      message: delivery.status === "queued"
        ? "A one-time password reset link was created and queued for delivery to the student's registered address."
        : "A one-time password reset link was created. SMTP is not configured; verify the student's identity and share it through the approved channel.",
      reset: { link: link.toString(), expiresAt },
      delivery,
    });
  } catch (error) {
    if (error.code === "STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (["ACTIVE_ACCOUNT_NOT_FOUND", "ACCOUNT_LINK_INVALID"].includes(error.code)) return res.status(409).json({ message: error.message });
    console.error("Create student password reset failed:", error.message);
    return res.status(500).json({ message: "Unable to issue a student password reset link." });
  } finally {
    await session.endSession();
  }
};

const setStudentAccountStatus = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const body = req.body || {};
  if (Object.keys(body).length !== 1 || typeof body.active !== "boolean") {
    return res.status(400).json({ message: "Provide only an active boolean value." });
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: { $ne: "archived" } })
        .select("+lifecycleLockVersion")
        .session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "ACTIVE_STUDENT_NOT_FOUND";
        throw error;
      }

      const nextLockVersion = (student.lifecycleLockVersion || 0) + 1;
      let account = student.userId
        ? await User.findOne({ _id: student.userId, role: "student" }).session(session)
        : await User.findOne({ email: student.email, role: "student" }).session(session);
      if (!account) {
        const error = new Error(student.userId
          ? "The linked account is missing or invalid; repair the account link before changing access."
          : "This student does not have an account yet; issue an invitation first.");
        error.code = student.userId ? "LINKED_ACCOUNT_MISSING" : "ACCOUNT_NOT_FOUND";
        throw error;
      }

      const accountLinkChanged = !student.userId;
      const accountStatusChanged = account.active !== body.active;
      if (!accountStatusChanged && !accountLinkChanged) {
        result = { active: account.active, accountLinkChanged: false };
        return;
      }
      if (accountLinkChanged) student.userId = account._id;
      student.lifecycleLockVersion = nextLockVersion;
      if (accountStatusChanged) {
        account.active = body.active;
        account.tokenVersion = (account.tokenVersion || 0) + 1;
        await account.save({ session });
        await StudentPasswordReset.updateMany(
          { studentId: student._id, usedAt: null, invalidatedAt: null },
          { $set: { invalidatedAt: new Date() } },
          { session }
        );
      }
      await student.save({ session });

      const eventType = accountStatusChanged
        ? body.active ? "student_account_reactivated" : "student_account_disabled"
        : "student_account_linked";
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType,
        studentId: student._id,
      }], { session });
      result = { active: account.active, accountLinkChanged };
    });
    return res.json({
      message: result?.active ? "Student account access is active." : "Student account access is disabled; active sessions were revoked.",
      ...result,
    });
  } catch (error) {
    if (error.code === "ACTIVE_STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (["LINKED_ACCOUNT_MISSING", "ACCOUNT_NOT_FOUND"].includes(error.code)) return res.status(409).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: "This student account is already linked to another student record." });
    console.error("Set student account status failed:", error.message);
    return res.status(500).json({ message: "Unable to update student account access." });
  } finally {
    await session.endSession();
  }
};

const updateStudent = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const normalized = normalizeStudentInput(req.body, { partial: true });
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const session = await mongoose.startSession();
  let updatedStudent;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: { $ne: "archived" } }).select("+lifecycleLockVersion").session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "ACTIVE_STUDENT_NOT_FOUND";
        throw error;
      }

      const previousEmail = student.email;
      const changedFields = Object.keys(normalized.value).filter((field) => {
        const currentValue = student[field] ?? "";
        const nextValue = normalized.value[field] ?? "";
        return currentValue !== nextValue;
      });
      const identityChanged = Boolean(
        (normalized.value.email && normalized.value.email !== previousEmail)
        || (normalized.value.name && normalized.value.name !== student.name)
      );
      Object.assign(student, normalized.value);
      await student.save({ session });

      // Older records may have an account matched by email but no explicit
      // userId. Sync once and persist the stable relationship while editing.
      const account = student.userId
        ? await User.findOne({ _id: student.userId, role: "student" }).session(session)
        : await User.findOne({ email: previousEmail, role: "student" }).session(session);
      if (student.userId && !account) {
        const error = new Error("The linked student account is missing; repair the account link before editing this record.");
        error.code = "LINKED_ACCOUNT_MISSING";
        throw error;
      }
      if (normalized.value.email && normalized.value.email !== previousEmail) {
        const accountConflict = await User.exists({
          email: student.email,
          ...(account ? { _id: { $ne: account._id } } : {}),
        }).session(session);
        if (accountConflict) {
          const error = new Error("An account with this email already exists.");
          error.code = 11000;
          throw error;
        }
      }
      if (account) {
        if (normalized.value.email && normalized.value.email !== previousEmail) account.email = student.email;
        if (normalized.value.name) account.name = student.name;
        await account.save({ session });
        if (!student.userId) {
          student.userId = account._id;
          await student.save({ session });
          changedFields.push("accountLink");
        }
      }
      if (identityChanged) {
        await StudentInvitation.updateMany(
          { studentId: student._id, usedAt: null, invalidatedAt: null },
          { $set: { invalidatedAt: new Date() } },
          { session }
        );
        await StudentPasswordReset.updateMany(
          { studentId: student._id, usedAt: null, invalidatedAt: null },
          { $set: { invalidatedAt: new Date() } },
          { session }
        );
      }
      if (changedFields.length) {
        await AuditEvent.create([{
          actorId: req.user.id,
          eventType: "student_updated",
          studentId: student._id,
          changedFields: [...new Set(changedFields)],
        }], { session });
      }
      updatedStudent = student;
    });
    if (!updatedStudent) return res.status(404).json({ message: "Student not found." });
    return res.json({ message: "Student and linked account updated successfully.", student: updatedStudent });
  } catch (error) {
    if (error.code === "ACTIVE_STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: isStudentNumberDuplicate(error) ? "This student number is already assigned." : "A student or account with this email already exists." });
    if (error.code === "LINKED_ACCOUNT_MISSING") return res.status(409).json({ message: error.message });
    if (error.name === "ValidationError") return res.status(400).json({ message: "Student data is invalid." });
    console.error("Update student failed:", error.message);
    return res.status(500).json({ message: "Failed to update student." });
  } finally {
    await session.endSession();
  }
};

const deleteStudent = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const session = await mongoose.startSession();
  let archivedStudent;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: { $ne: "archived" } }).session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "ACTIVE_STUDENT_NOT_FOUND";
        throw error;
      }
      student.status = "archived";
      student.lifecycleLockVersion = (student.lifecycleLockVersion || 0) + 1;
      await student.save({ session });

      const accountFilter = student.userId
        ? { _id: student.userId, role: "student" }
        : { email: student.email, role: "student" };
      const activeOfferingIds = await Enrollment.distinct("offeringId", {
        studentId: student._id,
        status: "active",
      }).session(session);
      await Enrollment.updateMany(
        { studentId: student._id, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: new Date() } },
        { session }
      );
      if (activeOfferingIds.length) {
        await CourseOffering.updateMany(
          { _id: { $in: activeOfferingIds } },
          { $inc: { rosterLockVersion: 1 } },
          { session }
        );
      }
      await User.updateOne(accountFilter, { $set: { active: false }, $inc: { tokenVersion: 1 } }, { session });
      await StudentInvitation.updateMany(
        { studentId: student._id, usedAt: null, invalidatedAt: null },
        { $set: { invalidatedAt: new Date() } },
        { session }
      );
      await StudentPasswordReset.updateMany(
        { studentId: student._id, usedAt: null, invalidatedAt: null },
        { $set: { invalidatedAt: new Date() } },
        { session }
      );
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "student_archived",
        studentId: student._id,
      }], { session });
      archivedStudent = student;
    });
    if (!archivedStudent) return res.status(404).json({ message: "Student not found." });
    return res.json({ message: "Student archived successfully; enrollments and account access were updated." });
  } catch (error) {
    if (error.code === "ACTIVE_STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Archive student failed:", error.message);
    return res.status(500).json({ message: "Failed to archive student." });
  } finally {
    await session.endSession();
  }
};

const restoreStudent = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid student ID." });
  const session = await mongoose.startSession();
  let restoredStudent;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: req.params.id, status: "archived" }).select("+lifecycleLockVersion").session(session);
      if (!student) {
        const error = new Error("Archived student record not found.");
        error.code = "ARCHIVED_STUDENT_NOT_FOUND";
        throw error;
      }
      const accountFilter = student.userId
        ? { _id: student.userId, role: "student" }
        : { email: student.email, role: "student" };
      const account = await User.findOne(accountFilter).session(session);
      if (student.userId && !account) {
        const error = new Error("The linked student account is missing; repair the account link before restoring this record.");
        error.code = "LINKED_ACCOUNT_MISSING";
        throw error;
      }
      student.status = "active";
      student.lifecycleLockVersion = (student.lifecycleLockVersion || 0) + 1;
      await student.save({ session });
      if (account) {
        account.active = true;
        account.tokenVersion = (account.tokenVersion || 0) + 1;
        await account.save({ session });
      }
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "student_restored",
        studentId: student._id,
      }], { session });
      restoredStudent = student;
    });
    return res.json({ message: "Student record restored. Previous enrollments remain withdrawn; enroll the student again where appropriate.", student: restoredStudent });
  } catch (error) {
    if (error.code === "ARCHIVED_STUDENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "LINKED_ACCOUNT_MISSING") return res.status(409).json({ message: error.message });
    console.error("Restore student failed:", error.message);
    return res.status(500).json({ message: "Unable to restore student record." });
  } finally {
    await session.endSession();
  }
};

module.exports = { getStudents, getStudent, createStudent, importStudents, createStudentInvitation, createStudentPasswordReset, setStudentAccountStatus, updateStudent, deleteStudent, restoreStudent };
