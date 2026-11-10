const express = require("express");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const {
  listOfferings,
  createOffering,
  archiveOffering,
  restoreOffering,
  listEnrollments,
  createEnrollment,
  withdrawEnrollment,
} = require("../controllers/academicController");
const {
  openSession,
  getSession,
  saveDraftMarks,
  finalizeSession,
  correctFinalizedMarks,
} = require("../controllers/attendanceController");
const {
  listAssessments,
  createAssessment,
  getAssessment,
  getAssessmentHistory,
  saveDraftGrades,
  publishAssessment,
  correctPublishedGrades,
} = require("../controllers/assessmentController");
const { getDashboardSummary, exportAcademicCsv, listAuditEvents } = require("../controllers/reportController");

const router = express.Router();
router.use(protect, adminOnly);
router.get("/dashboard/summary", getDashboardSummary);
router.get("/reports/export.csv", exportAcademicCsv);
router.get("/audit-events", listAuditEvents);
router.get("/offerings", listOfferings);
router.post("/offerings", createOffering);
router.post("/offerings/:id/archive", archiveOffering);
router.post("/offerings/:id/restore", restoreOffering);
router.get("/enrollments", listEnrollments);
router.post("/enrollments", createEnrollment);
router.delete("/enrollments/:id", withdrawEnrollment);
router.post("/attendance/sessions", openSession);
router.get("/attendance/sessions/:id", getSession);
router.put("/attendance/sessions/:id/marks", saveDraftMarks);
router.post("/attendance/sessions/:id/finalize", finalizeSession);
router.post("/attendance/sessions/:id/corrections", correctFinalizedMarks);
router.get("/assessments", listAssessments);
router.post("/assessments", createAssessment);
router.get("/assessments/:id", getAssessment);
router.get("/assessments/:id/history", getAssessmentHistory);
router.put("/assessments/:id/grades", saveDraftGrades);
router.post("/assessments/:id/publish", publishAssessment);
router.post("/assessments/:id/corrections", correctPublishedGrades);

module.exports = router;
