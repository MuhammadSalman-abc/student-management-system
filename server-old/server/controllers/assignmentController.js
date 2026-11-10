const Assignment = require("../models/Assignment");


// =========================
// GET ALL ASSIGNMENTS
// =========================

const getAssignments = async (req, res) => {
  try {
    const assignments = await Assignment.find()
      .sort({ createdAt: -1 });

    res.json(assignments);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch assignments.",
    });
  }
};


// =========================
// GET SINGLE ASSIGNMENT
// =========================

const getAssignment = async (req, res) => {
  try {
    const assignment =
      await Assignment.findById(
        req.params.id
      );

    if (!assignment) {
      return res.status(404).json({
        message: "Assignment not found.",
      });
    }

    res.json(assignment);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch assignment.",
    });
  }
};


// =========================
// CREATE ASSIGNMENT
// =========================

const createAssignment = async (req, res) => {
  try {
    const {
      title,
      description,
      course,
      batch,
      dueDate,
    } = req.body;


    if (
      !title ||
      !description ||
      !course ||
      !batch ||
      !dueDate
    ) {
      return res.status(400).json({
        message:
          "Please fill all assignment fields.",
      });
    }


    const assignment =
      await Assignment.create({
        title,
        description,
        course,
        batch,
        dueDate,
      });


    res.status(201).json({
      message:
        "Assignment created successfully.",
      assignment,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to create assignment.",
    });
  }
};


// =========================
// UPDATE ASSIGNMENT
// =========================

const updateAssignment = async (req, res) => {
  try {
    const assignment =
      await Assignment.findByIdAndUpdate(
        req.params.id,
        req.body,
        {
          new: true,
          runValidators: true,
        }
      );


    if (!assignment) {
      return res.status(404).json({
        message: "Assignment not found.",
      });
    }


    res.json({
      message:
        "Assignment updated successfully.",
      assignment,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message:
        "Failed to update assignment.",
    });
  }
};


// =========================
// DELETE ASSIGNMENT
// =========================

const deleteAssignment = async (req, res) => {
  try {
    const assignment =
      await Assignment.findByIdAndDelete(
        req.params.id
      );


    if (!assignment) {
      return res.status(404).json({
        message: "Assignment not found.",
      });
    }


    res.json({
      message:
        "Assignment deleted successfully.",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message:
        "Failed to delete assignment.",
    });
  }
};


module.exports = {
  getAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
};