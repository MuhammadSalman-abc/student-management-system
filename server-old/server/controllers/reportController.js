const Student = require("../models/Student");
const CourseOffering = require("../models/CourseOffering");
const mongoose = require("mongoose");
const Enrollment = require("../models/Enrollment");
const AttendanceSession = require("../models/AttendanceSession");
const AttendanceMark = require("../models/AttendanceMark");
const Assessment = require("../models/Assessment");
const AssessmentResult = require("../models/AssessmentResult");
const AuditEvent = require("../models/AuditEvent");
const { parsePagination } = require("../utils/pagination");

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const exportAcademicCsv = async (req, res) => {
  const { type, offeringId, from, to } = req.query;
  if (typeof type !== "string" || !["attendance", "results"].includes(type)) return res.status(400).json({ message: "Choose an attendance or results export." });
  if ([offeringId, from, to].some((value) => value !== undefined && typeof value !== "string")) return res.status(400).json({ message: "Provide one value for each report filter." });
  if (offeringId && !mongoose.isValidObjectId(offeringId)) return res.status(400).json({ message: "Invalid course offering." });
  for (const [key, value] of [["from", from], ["to", to]]) {
    if (value && !isValidDate(value)) return res.status(400).json({ message: `Invalid ${key} date; use YYYY-MM-DD.` });
  }
  if (from && to && from > to) return res.status(400).json({ message: "Start date must be on or before end date." });

  try {
    if (offeringId && !await CourseOffering.exists({ _id: offeringId })) return res.status(404).json({ message: "Course offering not found." });
    const pipeline = type === "attendance"
      ? [
        { $match: { status: "finalized", ...(offeringId ? { offeringId: new mongoose.Types.ObjectId(offeringId) } : {}), ...(from || to ? { sessionDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) } },
        { $lookup: { from: AttendanceMark.collection.name, localField: "_id", foreignField: "sessionId", as: "mark" } },
        { $unwind: "$mark" },
        { $limit: 20001 },
        { $lookup: { from: CourseOffering.collection.name, localField: "offeringId", foreignField: "_id", as: "offering" } },
        { $unwind: "$offering" },
        { $lookup: { from: Student.collection.name, localField: "mark.studentId", foreignField: "_id", as: "student" } },
        { $unwind: "$student" },
        { $project: { _id: 0, studentName: "$student.name", studentEmail: "$student.email", courseCode: "$offering.courseCode", courseName: "$offering.courseName", term: "$offering.term", section: "$offering.section", date: "$sessionDate", status: "$mark.status" } },
        { $sort: { date: 1, courseCode: 1, studentName: 1 } },
      ]
      : [
        { $match: { status: "published", ...(offeringId ? { offeringId: new mongoose.Types.ObjectId(offeringId) } : {}), ...(from || to ? { publishedAt: { ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}) } },
        { $lookup: { from: AssessmentResult.collection.name, localField: "_id", foreignField: "assessmentId", as: "result" } },
        { $unwind: "$result" },
        { $limit: 20001 },
        { $lookup: { from: CourseOffering.collection.name, localField: "offeringId", foreignField: "_id", as: "offering" } },
        { $unwind: "$offering" },
        { $lookup: { from: Student.collection.name, localField: "result.studentId", foreignField: "_id", as: "student" } },
        { $unwind: "$student" },
        { $project: { _id: 0, studentName: "$student.name", studentEmail: "$student.email", courseCode: "$offering.courseCode", courseName: "$offering.courseName", term: "$offering.term", section: "$offering.section", assessment: "$title", type: "$type", score: "$result.score", maxScore: "$maxScore", publishedAt: "$publishedAt" } },
        { $sort: { publishedAt: 1, courseCode: 1, studentName: 1 } },
      ];

    const rows = await (type === "attendance" ? AttendanceSession : Assessment).aggregate(pipeline);
    if (rows.length > 20000) return res.status(413).json({ message: "This export exceeds 20,000 rows. Add a course or date filter and try again." });
    const columns = type === "attendance"
      ? [["studentName", "Student name"], ["studentEmail", "Student email"], ["courseCode", "Course code"], ["courseName", "Course"], ["term", "Term"], ["section", "Section"], ["date", "Session date"], ["status", "Attendance"]]
      : [["studentName", "Student name"], ["studentEmail", "Student email"], ["courseCode", "Course code"], ["courseName", "Course"], ["term", "Term"], ["section", "Section"], ["assessment", "Assessment"], ["type", "Assessment type"], ["score", "Score"], ["maxScore", "Maximum score"], ["publishedAt", "Published at (UTC)"]];
    const csvCell = (value) => {
      let safe = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
      if (/^[\s\u0000-\u001f]*[=+\-@]/.test(safe)) safe = `'${safe}`;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [columns.map(([, label]) => csvCell(label)).join(","), ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(","))].join("\r\n");
    await AuditEvent.create({
      actorId: req.user.id,
      eventType: "academic_export",
      reportType: type,
      offeringId: offeringId || null,
      from: from || null,
      to: to || null,
      rowCount: rows.length,
    });
    const filename = `studenthub-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("Academic CSV export failed:", error.message);
    return res.status(500).json({ message: "Unable to create the academic export." });
  }
};

const listAuditEvents = async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  if (pagination.error) return res.status(400).json({ message: pagination.error });
  const { page, limit, offset } = pagination;
  try {
    const [totalRecords, events] = await Promise.all([
      AuditEvent.countDocuments(),
      AuditEvent.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .populate("actorId", "name email")
        .populate("studentId", "name email")
        .populate("offeringId", "courseCode courseName term section")
        .populate("assessmentId", "title type maxScore")
        .populate("attendanceSessionId", "sessionDate")
        .lean(),
    ]);
    return res.json({
      events: events.map((event) => ({
        eventType: event.eventType,
        reportType: event.reportType,
        actor: event.actorId ? { name: event.actorId.name, email: event.actorId.email } : null,
        student: event.studentId ? { name: event.studentId.name, email: event.studentId.email } : null,
        offering: event.offeringId ? {
          courseCode: event.offeringId.courseCode,
          courseName: event.offeringId.courseName,
          term: event.offeringId.term,
          section: event.offeringId.section,
        } : null,
        assessment: event.assessmentId ? {
          title: event.assessmentId.title,
          type: event.assessmentId.type,
          maxScore: event.assessmentId.maxScore,
        } : null,
        attendanceSession: event.attendanceSessionId ? { sessionDate: event.attendanceSessionId.sessionDate } : null,
        changedFields: event.changedFields || [],
        from: event.from,
        to: event.to,
        rowCount: event.rowCount,
        createdAt: event.createdAt,
      })),
      pagination: { currentPage: page, totalPages: Math.ceil(totalRecords / limit), totalRecords, limit },
    });
  } catch (error) {
    console.error("List audit events failed:", error.message);
    return res.status(500).json({ message: "Unable to load the audit trail." });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const [
      totalStudents,
      activeOfferings,
      [activeEnrollmentSummary],
      pendingAttendanceSessions,
      publishedAssessmentCount,
      draftAssessmentCount,
      attendanceGroups,
      [gradeSummary],
    ] = await Promise.all([
      Student.countDocuments({ status: { $ne: "archived" } }),
      CourseOffering.countDocuments({ status: "active" }),
      Enrollment.aggregate([
        { $match: { status: "active" } },
        { $lookup: { from: Student.collection.name, localField: "studentId", foreignField: "_id", as: "student" } },
        { $unwind: "$student" },
        { $match: { "student.status": { $ne: "archived" } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      AttendanceSession.countDocuments({ status: "draft" }),
      Assessment.countDocuments({ status: "published" }),
      Assessment.countDocuments({ status: "draft" }),
      AttendanceMark.aggregate([
        { $lookup: { from: AttendanceSession.collection.name, localField: "sessionId", foreignField: "_id", as: "session" } },
        { $unwind: "$session" },
        { $match: { "session.status": "finalized" } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      AssessmentResult.aggregate([
        { $lookup: { from: Assessment.collection.name, localField: "assessmentId", foreignField: "_id", as: "assessment" } },
        { $unwind: "$assessment" },
        { $match: { "assessment.status": "published" } },
        { $group: {
          _id: null,
          count: { $sum: 1 },
          averageScorePercent: { $avg: { $multiply: [{ $divide: ["$score", "$assessment.maxScore"] }, 100] } },
        } },
      ]),
    ]);

    const attendance = { present: 0, late: 0, absent: 0, excused: 0 };
    const activeEnrollments = activeEnrollmentSummary?.count || 0;
    for (const group of attendanceGroups) attendance[group._id] = group.count;
    const denominator = attendance.present + attendance.late + attendance.absent;
    attendance.rate = denominator
      ? Math.round(((attendance.present + attendance.late) / denominator) * 1000) / 10
      : null;
    attendance.countedSessions = denominator;

    return res.json({
      generatedAt: new Date().toISOString(),
      totalStudents,
      activeOfferings,
      activeEnrollments,
      pendingAttendanceSessions,
      attendance,
      assessments: {
        publishedCount: publishedAssessmentCount,
        draftCount: draftAssessmentCount,
        gradedResults: gradeSummary?.count || 0,
        averageScorePercent: gradeSummary?.averageScorePercent == null
          ? null
          : Math.round(gradeSummary.averageScorePercent * 10) / 10,
      },
      attendancePolicy: "present and late count as attended; excused is excluded from the denominator",
      gradePolicy: "average of each published score normalized by that assessment's maximum; not a course grade",
    });
  } catch (error) {
    console.error("Dashboard summary failed:", error.message);
    return res.status(500).json({ message: "Unable to load dashboard summary." });
  }
};

module.exports = { getDashboardSummary, exportAcademicCsv, listAuditEvents };
