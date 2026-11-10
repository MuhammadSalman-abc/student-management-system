const mongoose = require("mongoose");
const CourseOffering = require("../models/CourseOffering");
const Enrollment = require("../models/Enrollment");
const Student = require("../models/Student");
const Assessment = require("../models/Assessment");
const AssessmentResult = require("../models/AssessmentResult");
const AssessmentChange = require("../models/AssessmentChange");
const AuditEvent = require("../models/AuditEvent");
const findStudentForUser = require("../services/studentIdentity");
const { parsePagination } = require("../utils/pagination");

const assessmentTypes = new Set(["assignment", "quiz", "midterm", "final", "project", "other"]);

const getOfferingRoster = async (offeringId, status = "active", session = null) => {
  let query = Enrollment.find({ offeringId, status })
    .populate({ path: "studentId", match: { status: { $ne: "archived" } }, select: "name email status" });
  if (session) query = query.session(session);
  const enrollments = await query.lean();
  return enrollments.filter((item) => item.studentId).map((item) => item.studentId);
};

const buildAssessmentView = async (assessment) => {
  const [roster, results, offering] = await Promise.all([
    getOfferingRoster(assessment.offeringId),
    AssessmentResult.find({ assessmentId: assessment._id }).lean(),
    CourseOffering.findById(assessment.offeringId).select("courseCode courseName term section").lean(),
  ]);
  const resultByStudent = new Map(results.map((item) => [item.studentId.toString(), item]));
  return {
    assessment,
    offering,
    roster: roster.map((student) => ({ student, result: resultByStudent.get(student._id.toString()) || null })),
  };
};

const listAssessments = async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.offeringId)) return res.status(400).json({ message: "Choose a valid course offering." });
  const assessments = await Assessment.find({ offeringId: req.query.offeringId, status: { $ne: "archived" } })
    .sort({ dueDate: 1, createdAt: -1 }).lean();
  return res.json({ assessments });
};

const createAssessment = async (req, res) => {
  const body = req.body || {};
  const allowed = ["offeringId", "title", "type", "maxScore", "weight", "dueDate"];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) return res.status(400).json({ message: `Unsupported field: ${unknown}` });
  if (!mongoose.isValidObjectId(body.offeringId)) return res.status(400).json({ message: "Choose a valid course offering." });
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const type = body.type || "assignment";
  const maxScore = Number(body.maxScore);
  if (!title || title.length > 120 || !assessmentTypes.has(type) || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 100000) {
    return res.status(400).json({ message: "Provide a title, valid assessment type, and maximum score greater than 0." });
  }
  const offering = await CourseOffering.findOne({ _id: body.offeringId, status: "active" }).select("_id").lean();
  if (!offering) return res.status(404).json({ message: "Active course offering not found." });
  const data = { offeringId: body.offeringId, title, type, maxScore, createdBy: req.user.id };
  if (body.weight !== undefined && body.weight !== "") {
    const weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return res.status(400).json({ message: "Weight must be between 0 and 100." });
    data.weight = weight;
  }
  if (body.dueDate) {
    const dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ message: "Enter a valid due date." });
    data.dueDate = dueDate;
  }
  const assessment = await Assessment.create(data);
  return res.status(201).json({ message: "Assessment created as a draft.", assessment });
};

const getAssessment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment ID." });
  const assessment = await Assessment.findById(req.params.id).lean();
  if (!assessment || assessment.status === "archived") return res.status(404).json({ message: "Assessment not found." });
  return res.json(await buildAssessmentView(assessment));
};

const getAssessmentHistory = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment ID." });
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  if (pagination.error) return res.status(400).json({ message: pagination.error });
  const { page, limit, offset } = pagination;
  try {
    const assessmentExists = await Assessment.exists({ _id: req.params.id });
    if (!assessmentExists) return res.status(404).json({ message: "Assessment not found." });
    const filter = { assessmentId: req.params.id };
    const [totalRecords, changes] = await Promise.all([
      AssessmentChange.countDocuments(filter),
      AssessmentChange.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .populate("studentId", "name email")
        .populate("changedBy", "name")
        .lean(),
    ]);
    return res.json({
      changes: changes.map((change) => ({
        student: change.studentId ? { name: change.studentId.name, email: change.studentId.email } : null,
        changedBy: change.changedBy?.name || "Former account",
        previousScore: change.previousScore,
        newScore: change.newScore,
        previousFeedback: change.previousFeedback || "",
        newFeedback: change.newFeedback || "",
        reason: change.reason,
        changedAt: change.createdAt,
      })),
      pagination: { currentPage: page, totalPages: Math.ceil(totalRecords / limit), totalRecords, limit },
    });
  } catch (error) {
    console.error("Load assessment correction history failed:", error.message);
    return res.status(500).json({ message: "Unable to load assessment correction history." });
  }
};

const validateGrades = (grades, maxScore) => {
  if (!Array.isArray(grades) || grades.length < 1 || grades.length > 250) return { error: "Submit between 1 and 250 grades." };
  const seen = new Set();
  const normalized = [];
  for (const grade of grades) {
    if (!mongoose.isValidObjectId(grade?.studentId)) return { error: "Each grade must identify a valid student." };
    if (seen.has(grade.studentId)) return { error: "A student appears more than once in this grade update." };
    seen.add(grade.studentId);
    if ((typeof grade.score !== "number" && typeof grade.score !== "string") || String(grade.score).trim() === "") {
      return { error: "Each score is required and must be numeric." };
    }
    const score = Number(grade.score);
    const scaledScore = score * 100;
    if (!Number.isFinite(score) || score < 0 || score > maxScore || Math.abs(scaledScore - Math.round(scaledScore)) > 1e-8) {
      return { error: `Each score must be between 0 and ${maxScore}, with at most two decimal places.` };
    }
    const feedback = grade.feedback === undefined ? "" : grade.feedback;
    if (typeof feedback !== "string" || feedback.length > 500) return { error: "Feedback must be 500 characters or fewer." };
    normalized.push({ studentId: grade.studentId, score, feedback: feedback.trim() });
  }
  return { grades: normalized };
};

const saveDraftGrades = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment ID." });
  if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) {
    return res.status(400).json({ message: "A valid expected assessment revision is required." });
  }
  if (Object.keys(req.body || {}).some((key) => !["grades", "expectedRevision"].includes(key))) {
    return res.status(400).json({ message: "Only grades and expectedRevision are accepted." });
  }
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment || assessment.status === "archived") return res.status(404).json({ message: "Assessment not found." });
  if (assessment.status !== "draft") return res.status(409).json({ message: "Published grades can only be changed with a reasoned correction." });
  const validation = validateGrades(req.body?.grades, assessment.maxScore);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const roster = await getOfferingRoster(assessment.offeringId);
  const allowed = new Set(roster.map((student) => student._id.toString()));
  if (validation.grades.some((grade) => !allowed.has(grade.studentId))) return res.status(400).json({ message: "Grades may only be recorded for actively enrolled students." });
  const dbSession = await mongoose.startSession();
  let savedAssessment;
  try {
    await dbSession.withTransaction(async () => {
      const currentAssessment = await Assessment.findById(assessment._id).session(dbSession);
      if (!currentAssessment || currentAssessment.status !== "draft") {
        const error = new Error("Published grades can only be changed with a reasoned correction.");
        error.code = "ASSESSMENT_NOT_DRAFT";
        throw error;
      }
      if (currentAssessment.revision !== req.body.expectedRevision) {
        const error = new Error("This assessment changed since you opened it. Reload the latest version before saving.");
        error.code = "ASSESSMENT_STALE_REVISION";
        throw error;
      }
      const offering = await CourseOffering.findById(currentAssessment.offeringId).session(dbSession);
      if (!offering) {
        const error = new Error("Course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      offering.rosterLockVersion += 1;
      await offering.save({ session: dbSession });
      const currentRoster = await getOfferingRoster(currentAssessment.offeringId, "active", dbSession);
      const currentAllowed = new Set(currentRoster.map((student) => student._id.toString()));
      if (validation.grades.some((grade) => !currentAllowed.has(grade.studentId))) {
        const error = new Error("Grades may only be recorded for actively enrolled students.");
        error.code = "ASSESSMENT_ROSTER_CHANGED";
        throw error;
      }
      currentAssessment.revision += 1;
      await currentAssessment.save({ session: dbSession });
      const operations = validation.grades.map((grade) => ({
        updateOne: {
          filter: { assessmentId: currentAssessment._id, studentId: grade.studentId },
          update: { $set: { score: grade.score, feedback: grade.feedback, gradedBy: req.user.id, gradedAt: new Date() } },
          upsert: true,
        },
      }));
      await AssessmentResult.bulkWrite(operations, { ordered: true, session: dbSession });
      savedAssessment = currentAssessment.toObject();
    });
    return res.json({ message: "Grade draft saved.", ...(await buildAssessmentView(savedAssessment)) });
  } catch (error) {
    if (["ASSESSMENT_NOT_DRAFT", "ASSESSMENT_ROSTER_CHANGED", "ASSESSMENT_STALE_REVISION"].includes(error.code)) return res.status(409).json({ message: error.message });
    if (error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Save grade draft failed:", error.message);
    return res.status(500).json({ message: "Unable to save grade draft." });
  } finally {
    await dbSession.endSession();
  }
};

const publishAssessment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment ID." });
  if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) {
    return res.status(400).json({ message: "A valid expected assessment revision is required." });
  }
  if (Object.keys(req.body || {}).some((key) => key !== "expectedRevision")) {
    return res.status(400).json({ message: "Only expectedRevision is accepted." });
  }
  const dbSession = await mongoose.startSession();
  let publishedAssessment;
  try {
    await dbSession.withTransaction(async () => {
      const assessment = await Assessment.findById(req.params.id).session(dbSession);
      if (!assessment || assessment.status === "archived") {
        const error = new Error("Assessment not found.");
        error.code = "ASSESSMENT_NOT_FOUND";
        throw error;
      }
      if (assessment.status !== "draft") {
        const error = new Error("This assessment is already published.");
        error.code = "ASSESSMENT_ALREADY_PUBLISHED";
        throw error;
      }
      if (assessment.revision !== req.body.expectedRevision) {
        const error = new Error("This assessment changed since you opened it. Reload the latest version before publishing.");
        error.code = "ASSESSMENT_STALE_REVISION";
        throw error;
      }
      const offering = await CourseOffering.findById(assessment.offeringId).session(dbSession);
      if (!offering) {
        const error = new Error("Course offering not found.");
        error.code = "OFFERING_NOT_FOUND";
        throw error;
      }
      offering.rosterLockVersion += 1;
      await offering.save({ session: dbSession });
      const roster = await getOfferingRoster(assessment.offeringId, "active", dbSession);
      if (!roster.length) {
        const error = new Error("Enroll students before publishing this assessment.");
        error.code = "ASSESSMENT_EMPTY_ROSTER";
        throw error;
      }
      const gradedCount = await AssessmentResult.countDocuments({
        assessmentId: assessment._id,
        studentId: { $in: roster.map((student) => student._id) },
      }).session(dbSession);
      if (gradedCount !== roster.length) {
        const error = new Error(`Grade every active student before publishing (${gradedCount}/${roster.length} grades recorded).`);
        error.code = "ASSESSMENT_INCOMPLETE";
        throw error;
      }
      assessment.status = "published";
      assessment.publishedAt = new Date();
      assessment.publishedBy = req.user.id;
      assessment.revision += 1;
      await assessment.save({ session: dbSession });
      await AuditEvent.create([{
        actorId: req.user.id,
        eventType: "assessment_published",
        offeringId: offering._id,
        assessmentId: assessment._id,
        rowCount: roster.length,
      }], { session: dbSession });
      publishedAssessment = assessment.toObject();
    });
    return res.json({ message: "Results published to students.", ...(await buildAssessmentView(publishedAssessment)) });
  } catch (error) {
    if (error.code === "ASSESSMENT_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (error.code === "OFFERING_NOT_FOUND") return res.status(404).json({ message: error.message });
    if (["ASSESSMENT_ALREADY_PUBLISHED", "ASSESSMENT_EMPTY_ROSTER", "ASSESSMENT_INCOMPLETE", "ASSESSMENT_STALE_REVISION"].includes(error.code)) return res.status(409).json({ message: error.message });
    console.error("Publish assessment failed:", error.message);
    return res.status(500).json({ message: "Unable to publish assessment results." });
  } finally {
    await dbSession.endSession();
  }
};

const correctPublishedGrades = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment ID." });
  if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) {
    return res.status(400).json({ message: "A valid expected assessment revision is required." });
  }
  if (Object.keys(req.body || {}).some((key) => !["reason", "grades", "expectedRevision"].includes(key))) {
    return res.status(400).json({ message: "Only reason, grades, and expectedRevision are accepted." });
  }
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment || assessment.status !== "published") return res.status(409).json({ message: "Only published assessment results use the correction workflow." });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason || reason.length > 500) return res.status(400).json({ message: "Provide a correction reason (500 characters or fewer)." });
  const validation = validateGrades(req.body?.grades, assessment.maxScore);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const priorEnrollmentIds = await Enrollment.find({ offeringId: assessment.offeringId }).distinct("studentId");
  const allowed = new Set(priorEnrollmentIds.map(String));
  if (validation.grades.some((grade) => !allowed.has(grade.studentId))) return res.status(400).json({ message: "A correction can only update a student who was enrolled in this offering." });
  const dbSession = await mongoose.startSession();
  let correctedAssessment;
  try {
    await dbSession.withTransaction(async () => {
      const currentAssessment = await Assessment.findById(assessment._id).session(dbSession);
      if (!currentAssessment || currentAssessment.status !== "published") {
        const error = new Error("Only published assessment results use the correction workflow.");
        error.code = "ASSESSMENT_NOT_PUBLISHED";
        throw error;
      }
      if (currentAssessment.revision !== req.body.expectedRevision) {
        const error = new Error("This assessment changed since you opened it. Reload the latest version before correcting grades.");
        error.code = "ASSESSMENT_STALE_REVISION";
        throw error;
      }
      for (const grade of validation.grades) {
        const previous = await AssessmentResult.findOne({ assessmentId: currentAssessment._id, studentId: grade.studentId }).session(dbSession);
        if (!previous) {
          const error = new Error("Published grade record not found for a selected student.");
          error.code = "GRADE_NOT_FOUND";
          throw error;
        }
        await new AssessmentChange({
          assessmentId: currentAssessment._id,
          studentId: grade.studentId,
          previousScore: previous.score,
          newScore: grade.score,
          previousFeedback: previous.feedback,
          newFeedback: grade.feedback,
          reason,
          changedBy: req.user.id,
        }).save({ session: dbSession });
        previous.score = grade.score;
        previous.feedback = grade.feedback;
        previous.gradedBy = req.user.id;
        previous.gradedAt = new Date();
        await previous.save({ session: dbSession });
      }
      currentAssessment.revision += 1;
      await currentAssessment.save({ session: dbSession });
      correctedAssessment = currentAssessment.toObject();
    });
  } catch (error) {
    if (["ASSESSMENT_NOT_PUBLISHED", "ASSESSMENT_STALE_REVISION"].includes(error.code)) return res.status(409).json({ message: error.message });
    if (error.code === "GRADE_NOT_FOUND") return res.status(404).json({ message: error.message });
    console.error("Correct published grades failed:", error.message);
    return res.status(500).json({ message: "Unable to save grade corrections." });
  } finally {
    await dbSession.endSession();
  }
  return res.json({ message: "Published grades corrected and audited.", ...(await buildAssessmentView(correctedAssessment)) });
};

const getMyResults = async (req, res) => {
  const student = await findStudentForUser(req.user.id, req.user.email, "_id");
  if (!student) return res.status(404).json({ message: "Student profile not found." });
  const pagination = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  if (pagination.error) return res.status(400).json({ message: pagination.error });
  const { page, limit, offset } = pagination;
  const [result] = await AssessmentResult.aggregate([
    { $match: { studentId: student._id } },
    { $lookup: { from: Assessment.collection.name, localField: "assessmentId", foreignField: "_id", as: "assessment" } },
    { $unwind: "$assessment" },
    { $match: { "assessment.status": "published" } },
    { $sort: { "assessment.publishedAt": -1, gradedAt: -1 } },
    { $facet: {
      records: [
        { $skip: offset },
        { $limit: limit },
        { $lookup: { from: CourseOffering.collection.name, localField: "assessment.offeringId", foreignField: "_id", as: "offering" } },
        { $unwind: { path: "$offering", preserveNullAndEmptyArrays: true } },
        { $project: {
          _id: 0,
          score: 1,
          feedback: 1,
          gradedAt: 1,
          assessment: { title: "$assessment.title", type: "$assessment.type", maxScore: "$assessment.maxScore", weight: "$assessment.weight", publishedAt: "$assessment.publishedAt" },
          course: { courseCode: "$offering.courseCode", courseName: "$offering.courseName", term: "$offering.term", section: "$offering.section" },
        } },
      ],
      metadata: [{ $count: "total" }],
    } },
  ]);
  const total = result?.metadata?.[0]?.total || 0;
  return res.json({
    results: result?.records || [],
    pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRecords: total, limit },
  });
};

module.exports = { listAssessments, createAssessment, getAssessment, getAssessmentHistory, saveDraftGrades, publishAssessment, correctPublishedGrades, getMyResults };
