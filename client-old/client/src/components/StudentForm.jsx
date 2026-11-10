import { useState } from "react";

const getInitialForm = (student) => ({
  name: student?.name || "",
  email: student?.email || "",
  studentNumber: student?.studentNumber || "",
  course: student?.course || "",
  batch: student?.batch || "",
  attendance: student?.attendance ?? "",
  assignmentScore: student?.assignmentScore ?? student?.assignment ?? "",
  finalScore: student?.finalScore ?? "",
});

function StudentForm({
  student,
  onClose,
  onSave,
  saving = false,
  error = "",
  onError = () => {},
}) {
  const [form, setForm] = useState(() => getInitialForm(student));

  // =========================
  // UPDATE FIELD
  // =========================

  const update = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  // =========================
  // SUBMIT
  // =========================

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    const name = form.name.trim();
    const email = form.email.trim();
    const studentNumber = form.studentNumber.trim();
    const course = form.course.trim();
    const batch = form.batch.trim();

    if (!name || !email) {
      onError("Please complete all required fields.");
      return;
    }

    const legacyProfile = {};
    for (const [field, value] of [["course", course], ["batch", batch]]) {
      const currentValue = student?.[field] || "";
      if (student ? value !== currentValue : value !== "") legacyProfile[field] = value;
    }

    const legacySnapshots = {};
    for (const field of ["attendance", "assignmentScore", "finalScore"]) {
      if (form[field] === "") {
        if (student?.[field] != null) legacySnapshots[field] = "";
        continue;
      }
      const value = Number(form[field]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        onError("Optional legacy snapshot values must be between 0 and 100.");
        return;
      }
      legacySnapshots[field] = value;
    }

    onError("");
    await onSave({
      name,
      email,
      ...(student || studentNumber ? { studentNumber } : {}),
      ...legacyProfile,
      ...legacySnapshots,
    });
  };

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>

      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="student-form-title">

        {/* =========================
            HEADER
        ========================= */}

        <div className="modal-header">

          <div>

            <h2 id="student-form-title">
              {student
                ? "Edit Student"
                : "Add Student"}
            </h2>

            <p>
              {student
                ? "Update student information. A linked account’s name and sign-in email stay in sync."
                : "Enter new student information."}
            </p>

          </div>


          <button
            type="button"
            className="close-button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close student form"
          >
            ×
          </button>

        </div>


        {/* =========================
            FORM
        ========================= */}

        <form onSubmit={handleSubmit}>
          {error && <p className="student-form-error" role="alert">{error}</p>}

          <fieldset className="form-grid student-form-fieldset" disabled={saving}>

            {/* NAME */}

            <label>

              Student Name

              <input
                type="text"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) =>
                  update(
                    "name",
                    e.target.value
                  )
                }
                placeholder="Ali Ahmed"
              />

            </label>


            {/* EMAIL */}

            <label>

              Email

              <input
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={form.email}
                onChange={(e) =>
                  update(
                    "email",
                    e.target.value
                  )
                }
                placeholder="student@gmail.com"
              />

            </label>

            <label>
              Student number (optional)
              <input
                type="text"
                maxLength={40}
                autoComplete="off"
                value={form.studentNumber}
                onChange={(event) => update("studentNumber", event.target.value)}
                placeholder="e.g. 2026-001"
              />
            </label>


            {/* COURSE */}

            <label>

              Legacy course (optional)

              <input
                type="text"
                maxLength={120}
                value={form.course}
                onChange={(e) =>
                  update(
                    "course",
                    e.target.value
                  )
                }
                placeholder="MERN Stack"
              />

            </label>


            {/* BATCH */}

            <label>

              Legacy batch (optional)

              <input
                type="text"
                maxLength={120}
                value={form.batch}
                onChange={(e) =>
                  update(
                    "batch",
                    e.target.value
                  )
                }
                placeholder="Batch 2026"
              />

            </label>


            {/* ATTENDANCE */}

            <label>

                Legacy attendance snapshot (%) · optional

              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.attendance}
                onChange={(e) =>
                  update(
                    "attendance",
                    e.target.value
                  )
                }
                placeholder="88"
              />

            </label>


            {/* ASSIGNMENT */}

            <label>

                Legacy assignment snapshot (%) · optional

              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.assignmentScore}
                onChange={(e) =>
                  update(
                    "assignmentScore",
                    e.target.value
                  )
                }
                placeholder="82"
              />

            </label>


            {/* FINAL SCORE */}

            <label>

                Legacy final score snapshot (%) · optional

              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.finalScore}
                onChange={(e) =>
                  update(
                    "finalScore",
                    e.target.value
                  )
                }
                placeholder="91"
              />

            </label>

          </fieldset>

          <p className="student-form-help">Legacy course, batch, attendance, and score fields are optional. Manage current course placement under Academic Management → Enrollments; record current attendance in sessions and scores under Assessments.</p>

          {/* =========================
              ACTIONS
          ========================= */}

          <div className="modal-actions">

            <button
              type="button"
              className="cancel-button"
              disabled={saving}
              onClick={onClose}
            >
              {saving ? "Saving…" : "Cancel"}
            </button>


            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving ? "Saving…" : student
                ? "Update Student"
                : "Add Student"}
            </button>

          </div>

        </form>

      </div>

    </div>
  );
}

export default StudentForm;
