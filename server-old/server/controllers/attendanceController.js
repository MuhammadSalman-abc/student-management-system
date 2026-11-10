const mongoose = require("mongoose");
const CourseOffering = require("../models/CourseOffering");
const Enrollment = require("../models/Enrollment");
const Student = require("../models/Student");
const AttendanceSession = require("../models/AttendanceSession");
const AttendanceMark = require("../models/AttendanceMark");
const AttendanceChange = require("../models/AttendanceChange");
const AuditEvent = require("../models/AuditEvent");
const findStudentForUser = require("../services/studentIdentity");
const { parsePagination } = require("../utils/pagination");

const statuses = new Set(["present", "absent", "late", "excused"]);

const buildSessionView = async (session) => {
  const [enrollments, marks, offering] = await Promise.all([
    Enrollment.find({ offeringId: session.offeringId, status: "active" })
      .populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "name email status" }).lean(),
    AttendanceMark.find({ sessionId: session._id }).lean(),
    CourseOffering.findById(session.offeringId).select("courseCode courseName term section").lean(),
  ]);
  const markByStudent = new Map(marks.map((mark) => [mark.studentId.toString(), mark]));
  const roster = enrollments.filter((item) => item.studentId).map(({ studentId }) => ({
    student: studentId,
    mark: markByStudent.get(studentId._id.toString()) || null,
  }));
  return { session, offering, roster };
};

const openSession = async (req, res) => {
  const { offeringId, sessionDate } = req.body || {};
  if (!mongoose.isValidObjectId(offeringId) || typeof sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return res.status(400).json({ message: "Select a course and a valid session date (YYYY-MM-DD)." });
  }
  const parsedDate = new Date(`${sessionDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== sessionDate) {
    return res.status(400).json({ message: "The session date is not a valid calendar date." });
  }
  const offering = await CourseOffering.findOne({ _id: offeringId, status: "active" }).select("_id").lean();
  if (!offering) return res.status(404).json({ message: "Active course offering not found." });
  let session = await AttendanceSession.findOne({ offeringId, sessionDate });
  if (session) return res.json({ ...(await buildSessionView(session)), created: false });

  const activeRoster = await Enrollment.find({ offeringId, status: "active" })
    .populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "_id" }).lean();
  if (!activeRoster.some((item) => item.studentId)) {
    return res.status(409).json({ message: "Enroll at least one active student before taking attendance." });
  }
  try {
    session = await AttendanceSession.create({ offeringId, sessionDate, createdBy: req.user.id });
    return res.status(201).json({ ...(await buildSessionView(session)), created: true });
  } catch (error) {
    if (error.code === 11000) {
      session = await AttendanceSession.findOne({ offeringId, sessionDate });
      if (session) return res.json({ ...(await buildSessionView(session)), created: false });
    }
    console.error("Open attendance session failed:", error.message);
    return res.status(500).json({ message: "Unable to open attendance session." });
  }
};

const getSession = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid attendance session ID." });
  const session = await AttendanceSession.findById(req.params.id).lean();
  if (!session) return res.status(404).json({ message: "Attendance session not found." });
  return res.json(await buildSessionView(session));
};

const validateMarks = (marks) => {
  if (!Array.isArray(marks) || marks.length < 1 || marks.length > 250) return { error: "Submit between 1 and 250 attendance marks." };
  const seen = new Set();
  for (const mark of marks) {
    if (!mongoose.isValidObjectId(mark?.studentId) || !statuses.has(mark?.status)) return { error: "Each mark needs a valid student and attendance status." };
    if (seen.has(mark.studentId)) return { error: "A student appears more than once in this attendance update." };
    seen.add(mark.studentId);
  }
  return { studentIds: [...seen] };
};

const saveDraftMarks = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid attendance session ID." });
  const session = await AttendanceSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Attendance session not found." });
  if (session.status !== "draft") return res.status(409).json({ message: "Finalized attendance can only be changed using the correction workflow." });
  const validation = validateMarks(req.body?.marks);
  if (validation.error) return res.status(400).json({ message: validation.error });

  const enrollments = await Enrollment.find({
    offeringId: session.offeringId,
    studentId: { $in: validation.studentIds },
    status: "active",
  }).select("studentId").lean();
  const allowed = new Set(enrollments.map((item) => item.studentId.toString()));
  if (validation.studentIds.some((id) => !allowed.has(id))) return res.status(400).json({ message: "Attendance includes a student who is not actively enrolled in this course." });

  const dbSession = await mongoose.startSession();
  let savedSession;
  try {
    await dbSession.withTransaction(async () => {
      const currentSession = await AttendanceSession.findById(session._id).session(dbSession);
      if (!currentSession || currentSession.status !== "draft") {
        const error = new Error("Finalized attendance can only be changed using the correction workflow.");
        error.code = "ATTENDANCE_NOT_DRAFT";
        throw error;
      }
      const offering = await CourseOffering.findById(currentSession.offeringId).session(dbSession);
      if (!offering) {
        const error = new Error("Course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      offering.rosterLockVersion += 1;
      await offering.save({ session: dbSession });
      const currentEnrollments = await Enrollment.find({
        offeringId: currentSession.offeringId,
        studentId: { $in: validation.studentIds },
        status: "active",
      }).select("studentId").session(dbSession).lean();
      const currentAllowed = new Set(currentEnrollments.map((item) => item.studentId.toString()));
      if (validation.studentIds.some((id) => !currentAllowed.has(id))) {
        const error = new Error("Attendance includes a student who is no longer actively enrolled in this course.");
        error.code = "ATTENDANCE_ROSTER_CHANGED";
        throw error;
      }
      currentSession.revision += 1;
      await currentSession.save({ session: dbSession });
      const operations = req.body.marks.map((mark) => ({
        updateOne: {
          filter: { sessionId: currentSession._id, studentId: mark.studentId },
          update: { $set: { status: mark.status, recordedBy: req.user.id, markedAt: new Date() } },
          upsert: true,
        },
      }));
      await AttendanceMark.bulkWrite(operations, { ordered: true, session: dbSession });
      savedSession = currentSession.toObject();
    });
    if (!savedSession) return res.status(404).json({ message: "Attendance session not found." });
    return res.json({ message: "Attendance draft saved.", ...(await buildSessionView(savedSession)) });
  } catch (error) {
    if (error.code === "ATTENDANCE_NOT_DRAFT") return res.status(409).json({ message: error.message });
    if (error.code === "ATTENDANCE_ROSTER_CHANGED") return res.status(409).json({ message: error.message });
    if (error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Save attendance draft failed:", error.message);
    return res.status(500).json({ message: "Unable to save attendance." });
  } finally {
    await dbSession.endSession();
  }
};

const finalizeSession = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid attendance session ID." });
  const dbSession = await mongoose.startSession();
  let finalizedSession;
  try {
    await dbSession.withTransaction(async () => {
      const session = await AttendanceSession.findById(req.params.id).session(dbSession);
      if (!session) {
        const error = new Error("Attendance session not found.");
        error.code = "ATTENDANCE_NOT_FOUND";
        throw error;
      }
      if (session.status !== "draft") {
        const error = new Error("This attendance session is already finalized.");
        error.code = "ATTENDANCE_ALREADY_FINALIZED";
        throw error;
      }
      const offering = await CourseOffering.findById(session.offeringId).session(dbSession);
      if (!offering) {
        const error = new Error("Course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      offering.rosterLockVersion += 1;
      await offering.save({ session: dbSession });
      const enrollments = await Enrollment.find({ offeringId: session.offeringId, status: "active" })
        .populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "_id" })
        .session(dbSession).lean();
      const rosterIds = enrollments.filter((item) => item.studentId).map((item) => item.studentId._id);
      const markedCount = await AttendanceMark.countDocuments({ sessionId: session._id, studentId: { $in: rosterIds } }).session(dbSession);
      if (!rosterIds.length || markedCount !== rosterIds.length) {
        const error = new Error(`Mark attendance for every active student before finalizing (${markedCount}/${rosterIds.length} recorded).`);
        error.code = "ATTENDANCE_INCOMPLETE";
        throw error;
      }
      session.status = "finalized";
      session.finalizedBy = req.user.id;
      session.finalizedAt = new Date();
      session.revision += 1;
      await session.save({ session: dbSession });
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "attendance_finalized",
        offeringId: offering._id,
        attendanceSessionId: session._id,
        rowCount: markedCount,
      }], { session: dbSession });
      finalizedSession = session.toObject();
    });
    return res.json({ message: "Attendance finalized and released to students.", ...(await buildSessionView(finalizedSession)) });
  } catch (error) {
    if (error.code === "ATTENDANCE_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (["ATTENDANCE_ALREADY_FINALIZED", "ATTENDANCE_INCOMPLETE"].includes(error.code)) return res.status(409).json({ message: error.message });
    console.error("Finalize attendance failed:", error.message);
    return res.status(500).json({ message: "Unable to finalize attendance." });
  } finally {
    await dbSession.endSession();
  }
};

const correctFinalizedMarks = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid attendance session ID." });
  const session = await AttendanceSession.findById(req.params.id);
  if (!session) return res.status(404).json({ message: "Attendance session not found." });
  if (session.status !== "finalized") return res.status(409).json({ message: "Use draft editing before finalizing attendance." });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason || reason.length > 500) return res.status(400).json({ message: "Provide a correction reason (500 characters or fewer)." });
  const validation = validateMarks(req.body?.marks);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const enrollmentIds = await Enrollment.find({ offeringId: session.offeringId }).distinct("studentId");
  const allowed = new Set(enrollmentIds.map(String));
  if (validation.studentIds.some((id) => !allowed.has(id))) return res.status(400).json({ message: "Attendance correction includes a student outside this course roster." });

  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      const currentSession = await AttendanceSession.findById(session._id).session(dbSession);
      if (!currentSession || currentSession.status !== "finalized") {
        const error = new Error("Attendance session is no longer finalized.");
        error.code = "ATTENDANCE_NOT_FINALIZED";
        throw error;
      }
      for (const item of req.body.marks) {
        const existing = await AttendanceMark.findOne({ sessionId: currentSession._id, studentId: item.studentId }).session(dbSession);
        const change = new AttendanceChange({
          sessionId: currentSession._id,
          studentId: item.studentId,
          previousStatus: existing?.status || null,
          newStatus: item.status,
          reason,
          changedBy: req.user.id,
        });
        await change.save({ session: dbSession });
        if (existing) {
          existing.status = item.status;
          existing.recordedBy = req.user.id;
          existing.markedAt = new Date();
          await existing.save({ session: dbSession });
        } else {
          await new AttendanceMark({
            sessionId: currentSession._id,
            studentId: item.studentId,
            status: item.status,
            recordedBy: req.user.id,
            markedAt: new Date(),
          }).save({ session: dbSession });
        }
      }
    });
    return res.json({ message: "Attendance correction saved and audited.", ...(await buildSessionView(session.toObject())) });
  } catch (error) {
    if (error.code === "ATTENDANCE_NOT_FINALIZED") return res.status(409).json({ message: error.message });
    console.error("Correct attendance failed:", error.message);
    return res.status(500).json({ message: "Unable to save attendance correction." });
  } finally {
    await dbSession.endSession();
  }
};

const getMyAttendance = async (req, res) => {
  const student = await findStudentForUser(req.user.id, req.user.email, "_id");
  if (!student) return res.status(404).json({ message: "Student profile not found." });
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  if (pagination.error) return res.status(400).json({ message: pagination.error });
  const { page, limit, offset } = pagination;
  const [result] = await AttendanceMark.aggregate([
    { $match: { studentId: student._id } },
    { $lookup: { from: AttendanceSession.collection.name, localField: "sessionId", foreignField: "_id", as: "session" } },
    { $unwind: "$session" },
    { $match: { "session.status": "finalized" } },
    { $sort: { "session.sessionDate": -1, createdAt: -1 } },
    { $facet: {
      records: [
        { $skip: offset },
        { $limit: limit },
        { $lookup: { from: CourseOffering.collection.name, localField: "session.offeringId", foreignField: "_id", as: "offering" } },
        { $unwind: { path: "$offering", preserveNullAndEmptyArrays: true } },
        { $project: {
          _id: 0,
          date: "$session.sessionDate",
          status: 1,
          course: { courseCode: "$offering.courseCode", courseName: "$offering.courseName", term: "$offering.term", section: "$offering.section" },
        } },
      ],
      metadata: [{ $count: "total" }],
      summary: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
    } },
  ]);
  const records = result?.records || [];
  const total = result?.metadata?.[0]?.total || 0;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const item of result?.summary || []) counts[item._id] = item.count;
  const denominator = counts.present + counts.absent + counts.late;
  const percentage = denominator ? Math.round(((counts.present + counts.late) / denominator) * 1000) / 10 : null;
  return res.json({
    records,
    summary: { ...counts, percentage, countedSessions: denominator },
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRecords: total, limit },
  });
};

module.exports = { openSession, getSession, saveDraftMarks, finalizeSession, correctFinalizedMarks, getMyAttendance };
