const mongoose = require("mongoose");
const CourseOffering = require("../models/CourseOffering");
const Enrollment = require("../models/Enrollment");
const Student = require("../models/Student");
const AuditEvent = require("../models/AuditEvent");
const { parsePagination } = require("../utils/pagination");

const listOfferings = async (req, res) => {
  if (req.query.status !== undefined && (typeof req.query.status !== "string" || !["active", "archived", "all"].includes(req.query.status))) {
    return res.status(400).json({ message: "Status must be active, archived, or all." });
  }
  const status = req.query.status || "active";
  const filter = status === "all" ? {} : { status };
  const offerings = await CourseOffering.find(filter)
    .sort({ term: -1, courseCode: 1, section: 1 }).lean();
  return res.json({ offerings });
};

const archiveOffering = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid course offering ID." });
  const session = await mongoose.startSession();
  let offering;
  try {
    await session.withTransaction(async () => {
      const currentOffering = await CourseOffering.findOne({ _id: req.params.id, status: "active" }).session(session);
      if (!currentOffering) {
        const error = new Error("Active course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      if (await Enrollment.exists({ offeringId: currentOffering._id, status: "active" }).session(session)) {
        const error = new Error("Withdraw or reassign all active enrollments before archiving this offering.");
        error.code = "ACTIVE_ENROLLMENTS";
        throw error;
      }
      currentOffering.status = "archived";
      currentOffering.rosterLockVersion += 1;
      offering = await currentOffering.save({ session });
      await AuditEvent.create([{ actorId: req.user.id, eventType: "offering_archived", offeringId: offering._id }], { session });
    });
    return res.json({ message: "Course offering archived; academic history retained.", offering });
  } catch (error) {
    if (error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "ACTIVE_ENROLLMENTS") return res.status(409).json({ message: error.message });
    console.error("Archive course offering failed:", error.message);
    return res.status(500).json({ message: "Unable to archive course offering." });
  } finally {
    await session.endSession();
  }
};

const restoreOffering = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid course offering ID." });
  const session = await mongoose.startSession();
  let offering;
  try {
    await session.withTransaction(async () => {
      const currentOffering = await CourseOffering.findOne({ _id: req.params.id, status: "archived" }).session(session);
      if (!currentOffering) {
        const error = new Error("Archived course offering not found.");
        error.code = "ARCHIVED_OFFERING_NOT_FOUND";
        throw error;
      }
      currentOffering.status = "active";
      currentOffering.rosterLockVersion += 1;
      offering = await currentOffering.save({ session });
      await AuditEvent.create([{ actorId: req.user.id, eventType: "offering_restored", offeringId: offering._id }], { session });
    });
    return res.json({ message: "Course offering restored. Previous enrollment history remains unchanged.", offering });
  } catch (error) {
    if (error.code === "ARCHIVED_OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Restore course offering failed:", error.message);
    return res.status(500).json({ message: "Unable to restore course offering." });
  } finally {
    await session.endSession();
  }
};

const createOffering = async (req, res) => {
  const body = req.body || {};
  const allowed = ["courseCode", "courseName", "term", "section", "startDate", "endDate"];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) return res.status(400).json({ message: `Unsupported field: ${unknown}` });

  const courseCode = typeof body.courseCode === "string" ? body.courseCode.trim().toUpperCase() : "";
  const courseName = typeof body.courseName === "string" ? body.courseName.trim() : "";
  const term = typeof body.term === "string" ? body.term.trim() : "";
  const section = typeof body.section === "string" ? body.section.trim() : "";
  if (!courseCode || courseCode.length > 24 || !courseName || courseName.length > 120 || !term || term.length > 60 || !section || section.length > 30) {
    return res.status(400).json({ message: "Provide a course code, course name, term, and section within the allowed lengths." });
  }
  const data = { courseCode, courseName, term, section, createdBy: req.user.id };
  for (const field of ["startDate", "endDate"]) {
    if (body[field] !== undefined && body[field] !== "") {
      const date = new Date(body[field]);
      if (Number.isNaN(date.getTime())) return res.status(400).json({ message: `Invalid ${field}.` });
      data[field] = date;
    }
  }
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    return res.status(400).json({ message: "Course end date must be on or after its start date." });
  }
  try {
    const offering = await CourseOffering.create(data);
    return res.status(201).json({ message: "Course offering created.", offering });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "That course, term, and section already exist." });
    console.error("Create course offering failed:", error.message);
    return res.status(500).json({ message: "Unable to create course offering." });
  }
};

const listEnrollments = async (req, res) => {
  if (req.query.status !== undefined && (typeof req.query.status !== "string" || !["active", "withdrawn", "all"].includes(req.query.status))) {
    return res.status(400).json({ message: "Status must be active, withdrawn, or all." });
  }
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  if (pagination.error) return res.status(400).json({ message: pagination.error });
  const { page, limit, offset } = pagination;
  const status = req.query.status || "active";
  const filter = status === "all" ? { status: { $in: ["active", "withdrawn"] } } : { status };
  try {
    const enrollmentFilter = { ...filter };
      const [totalRecords, enrollments, groupedCounts] = await Promise.all([
      Enrollment.countDocuments(enrollmentFilter),
      Enrollment.find(enrollmentFilter)
        .populate("studentId", "name email course batch status")
        .populate("offeringId", "courseCode courseName term section status")
        .sort({ enrolledAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      Enrollment.aggregate([
        { $match: enrollmentFilter },
        { $lookup: { from: "students", localField: "studentId", foreignField: "_id", as: "student" } },
        { $unwind: "$student" },
        { $match: { "student.status": { $ne: "archived" } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const counts = { active: 0, withdrawn: 0 };
    for (const item of groupedCounts) counts[item._id] = item.count;
    return res.json({
      enrollments,
      counts,
      pagination: { currentPage: page, totalPages: Math.ceil(totalRecords / limit), totalRecords, limit },
    });
  } catch (error) {
    console.error("List enrollments failed:", error.message);
    return res.status(500).json({ message: "Unable to load enrollment history." });
  }
};

const createEnrollment = async (req, res) => {
  const { studentId, offeringId } = req.body || {};
  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(offeringId)) {
    return res.status(400).json({ message: "Select a valid student and course offering." });
  }
  const session = await mongoose.startSession();
  let enrollment;
  let created = false;
  try {
    await session.withTransaction(async () => {
      const student = await Student.findOne({ _id: studentId, status: { $ne: "archived" } }).select("_id +lifecycleLockVersion").session(session);
      if (!student) {
        const error = new Error("Active student record not found.");
        error.code = "STUDENT_NOT_FOUND";
        throw error;
      }
      student.lifecycleLockVersion = (student.lifecycleLockVersion || 0) + 1;
      await student.save({ session });
      const offering = await CourseOffering.findOne({ _id: offeringId, status: "active" }).session(session);
      if (!offering) {
        const error = new Error("Active course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      const existing = await Enrollment.findOne({ studentId, offeringId }).session(session);
      if (existing?.status === "active") {
        const error = new Error("Student is already enrolled in this course offering.");
        error.code = "ALREADY_ENROLLED";
        throw error;
      }
      if (existing) {
        existing.status = "active";
        existing.enrolledAt = new Date();
        existing.withdrawnAt = undefined;
        existing.createdBy = req.user.id;
        enrollment = await existing.save({ session });
        created = false;
      } else {
        enrollment = await new Enrollment({ studentId, offeringId, createdBy: req.user.id }).save({ session });
        created = true;
      }
      offering.rosterLockVersion += 1;
      await offering.save({ session });
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: created ? "enrollment_created" : "enrollment_reactivated",
        studentId: student._id,
        offeringId: offering._id,
      }], { session });
    });
    return res.status(created ? 201 : 200).json({
      message: created ? "Student enrolled successfully." : "Enrollment reactivated.",
      enrollment,
    });
  } catch (error) {
    if (error.code === "STUDENT_NOT_FOUND" || error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "ALREADY_ENROLLED") return res.status(409).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: "Student is already enrolled in this course offering." });
    console.error("Create enrollment failed:", error.message);
    return res.status(500).json({ message: "Unable to create enrollment." });
  } finally {
    await session.endSession();
  }
};

const withdrawEnrollment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid enrollment ID." });
  const session = await mongoose.startSession();
  let enrollment;
  try {
    await session.withTransaction(async () => {
      enrollment = await Enrollment.findOne({ _id: req.params.id, status: "active" }).session(session);
      if (!enrollment) {
        const error = new Error("Active enrollment not found.");
        error.code = "ENROLLMENT_NOT_FOUND";
        throw error;
      }
      const offering = await CourseOffering.findById(enrollment.offeringId).session(session);
      if (!offering) {
        const error = new Error("Course offering not found for this enrollment.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      enrollment.status = "withdrawn";
      enrollment.withdrawnAt = new Date();
      await enrollment.save({ session });
      offering.rosterLockVersion += 1;
      await offering.save({ session });
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "enrollment_withdrawn",
        studentId: enrollment.studentId,
        offeringId: offering._id,
      }], { session });
    });
    return res.json({ message: "Enrollment withdrawn.", enrollment });
  } catch (error) {
    if (error.code === "ENROLLMENT_NOT_FOUND" || error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Withdraw enrollment failed:", error.message);
    return res.status(500).json({ message: "Unable to withdraw enrollment." });
  } finally {
    await session.endSession();
  }
};

module.exports = { listOfferings, createOffering, archiveOffering, restoreOffering, listEnrollments, createEnrollment, withdrawEnrollment };
