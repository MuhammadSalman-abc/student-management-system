const express = require("express");

const {
  protect,
  adminOnly,
  studentOnly,
} = require("../middleware/authMiddleware");

const findStudentForUser = require("../services/studentIdentity");
const { getMyAttendance } = require("../controllers/attendanceController");
const { getMyResults } = require("../controllers/assessmentController");

const {
  getStudents,
  getStudent,
  createStudent,
  importStudents,
  createStudentInvitation,
  createStudentPasswordReset,
  setStudentAccountStatus,
  updateStudent,
  deleteStudent,
  restoreStudent,
} = require("../controllers/studentController");

const router = express.Router();


// =====================================
// LOGGED-IN STUDENT PROFILE
// =====================================

router.get(
  "/me",
  protect,
  studentOnly,
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    try {

      const student = await findStudentForUser(req.user.id, req.user.email);


      if (!student) {
        return res.status(404).json({
          message:
            "Student record not found.",
        });
      }


      res.json(student);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        message: "Server error.",
      });

    }
  }
);

router.get("/me/attendance", protect, studentOnly, getMyAttendance);
router.get("/me/results", protect, studentOnly, getMyResults);


// =====================================
// ADMIN ROUTES
// =====================================

router.get(
  "/",
  protect,
  adminOnly,
  getStudents
);


router.get(
  "/:id",
  protect,
  adminOnly,
  getStudent
);


router.post(
  "/:id/invitation",
  protect,
  adminOnly,
  createStudentInvitation
);

router.patch("/:id/account-status", protect, adminOnly, setStudentAccountStatus);
router.post("/:id/password-reset", protect, adminOnly, createStudentPasswordReset);


router.post(
  "/import",
  protect,
  adminOnly,
  importStudents
);

router.post(
  "/",
  protect,
  adminOnly,
  createStudent
);


router.put(
  "/:id",
  protect,
  adminOnly,
  updateStudent
);


router.delete(
  "/:id",
  protect,
  adminOnly,
  deleteStudent
);

router.patch("/:id/restore", protect, adminOnly, restoreStudent);


module.exports = router;
