import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionMarker } from "../sessionState";
import {
  correctAttendanceMarks,
  archiveCourseOffering,
  createCourseOffering,
  enrollStudent,
  finalizeAttendanceSession,
  getAcademicSetup,
  getEnrollmentPage,
  getStudents,
  openAttendanceSession,
  restoreCourseOffering,
  saveAttendanceMarks,
  withdrawStudentEnrollment,
} from "../api";
import AssessmentManagement from "./AssessmentManagement";
import ConfirmDialog from "./ConfirmDialog";

const emptyOffering = { courseCode: "", courseName: "", term: "", section: "", startDate: "", endDate: "" };
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function AcademicManagement({ onSummaryRefresh }) {
  const [offerings, setOfferings] = useState([]);
  const [archivedOfferings, setArchivedOfferings] = useState([]);
  const [offeringToArchive, setOfferingToArchive] = useState(null);
  const [offeringToRestore, setOfferingToRestore] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [enrollmentStatus, setEnrollmentStatus] = useState("active");
  const [enrollmentPage, setEnrollmentPage] = useState(1);
  const [enrollmentPagination, setEnrollmentPagination] = useState({ page: 1, totalPages: 1, totalRecords: 0 });
  const [enrollmentCounts, setEnrollmentCounts] = useState({ active: 0, withdrawn: 0 });
  const [loadedEnrollmentRequest, setLoadedEnrollmentRequest] = useState("");
  const enrollmentRequest = useRef(0);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [studentOptions, setStudentOptions] = useState([]);
  const [studentPagination, setStudentPagination] = useState({ currentPage: 1, totalPages: 1, totalStudents: 0 });
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [studentSearchError, setStudentSearchError] = useState("");
  const studentRequest = useRef(0);
  const [offeringForm, setOfferingForm] = useState(emptyOffering);
  const [enrollmentForm, setEnrollmentForm] = useState({ studentId: "", offeringId: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [attendanceOfferingId, setAttendanceOfferingId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(localDate());
  const [attendanceSession, setAttendanceSession] = useState(null);
  const [attendanceRoster, setAttendanceRoster] = useState([]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [enrollmentToWithdraw, setEnrollmentToWithdraw] = useState(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const load = useCallback(async () => {
    const token = getSessionMarker();
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const [offeringData, archivedOfferingData] = await Promise.all([
      getAcademicSetup(token),
      getAcademicSetup(token, "archived"),
    ]);
    setOfferings(offeringData.offerings || []);
    setArchivedOfferings(archivedOfferingData.offerings || []);
  }, []);

  useEffect(() => {
    let active = true;
    const requestId = ++studentRequest.current;
    const timer = setTimeout(async () => {
      setStudentSearchLoading(true);
      setStudentSearchError("");
      try {
        const result = await getStudents(getSessionMarker(), studentPage, 20, {
          search: studentSearch.trim(),
          status: "active",
        });
        if (!active || requestId !== studentRequest.current) return;
        setStudentOptions(result.students || []);
        setStudentPagination(result.pagination || { currentPage: studentPage, totalPages: 1, totalStudents: 0 });
      } catch (error) {
        if (active && requestId === studentRequest.current) setStudentSearchError(error.message || "Could not load students.");
      } finally {
        if (active && requestId === studentRequest.current) setStudentSearchLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [studentPage, studentSearch]);

  const loadEnrollments = useCallback(async () => {
    const requestId = ++enrollmentRequest.current;
    const result = await getEnrollmentPage(getSessionMarker(), enrollmentStatus, enrollmentPage);
    if (requestId !== enrollmentRequest.current) return;
    setEnrollments(result.enrollments || []);
    setEnrollmentPagination(result.pagination || { currentPage: 1, totalPages: 1, totalRecords: 0 });
    setEnrollmentCounts(result.counts || { active: 0, withdrawn: 0 });
  }, [enrollmentStatus, enrollmentPage]);

  const enrollmentRequestKey = `${enrollmentStatus}:${enrollmentPage}`;
  const enrollmentLoading = loadedEnrollmentRequest !== enrollmentRequestKey;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await load();
      } catch (error) {
        if (active) setNotice({ type: "error", text: error.message });
      }
    })();
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    let active = true;
    loadEnrollments().catch((error) => {
      if (active) setNotice({ type: "error", text: error.message });
    }).finally(() => {
      if (active) {
        setLoadedEnrollmentRequest(enrollmentRequestKey);
      }
    });
    return () => { active = false; };
  }, [loadEnrollments, enrollmentRequestKey]);

  const handleCreateOffering = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const token = getSessionMarker();
      const payload = Object.fromEntries(Object.entries(offeringForm).filter(([, value]) => value !== ""));
      const result = await createCourseOffering(payload, token);
      setOfferings((current) => [...current, result.offering].sort((a, b) => a.courseCode.localeCompare(b.courseCode)));
      setOfferingForm(emptyOffering);
      setNotice({ type: "success", text: "Course offering created." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveOffering = async () => {
    if (!offeringToArchive) return;
    setSaving(true);
    try {
      const result = await archiveCourseOffering(offeringToArchive._id, getSessionMarker());
      setOfferings((current) => current.filter((item) => item._id !== offeringToArchive._id));
      setArchivedOfferings((current) => [result.offering, ...current]);
      setOfferingToArchive(null);
      setNotice({ type: "success", text: "Course offering archived. Academic history was retained." });
      await onSummaryRefresh?.();
    } catch (error) {
      setOfferingToArchive(null);
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreOffering = async () => {
    if (!offeringToRestore) return;
    setSaving(true);
    try {
      const result = await restoreCourseOffering(offeringToRestore._id, getSessionMarker());
      setArchivedOfferings((current) => current.filter((item) => item._id !== offeringToRestore._id));
      setOfferings((current) => [result.offering, ...current].sort((a, b) => a.courseCode.localeCompare(b.courseCode)));
      setOfferingToRestore(null);
      setNotice({ type: "success", text: "Course offering restored. Re-enroll students as needed." });
      await onSummaryRefresh?.();
    } catch (error) {
      setOfferingToRestore(null);
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleEnroll = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const token = getSessionMarker();
      await enrollStudent(enrollmentForm, token);
      setEnrollmentPage(1);
      await loadEnrollments();
      setEnrollmentForm({ studentId: "", offeringId: "" });
      setSelectedStudent(null);
      setNotice({ type: "success", text: "Student enrolled in the course." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async () => {
    if (!enrollmentToWithdraw) return;
    setSaving(true);
    try {
      await withdrawStudentEnrollment(enrollmentToWithdraw._id, getSessionMarker());
      setEnrollmentToWithdraw(null);
      await loadEnrollments();
      setNotice({ type: "success", text: "Enrollment withdrawn; history retained." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async (item) => {
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      await enrollStudent({ studentId: item.studentId?._id, offeringId: item.offeringId?._id }, getSessionMarker());
      await loadEnrollments();
      setNotice({ type: "success", text: "Enrollment reactivated." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const applyAttendanceResponse = (result) => {
    setAttendanceSession(result.session);
    setAttendanceRoster((result.roster || []).map(({ student, mark }) => ({
      student,
      status: mark?.status || "",
      savedStatus: mark?.status || "",
    })));
  };

  const handleOpenAttendance = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const result = await openAttendanceSession(
        { offeringId: attendanceOfferingId, sessionDate: attendanceDate },
        getSessionMarker()
      );
      applyAttendanceResponse(result);
      setCorrectionReason("");
      setNotice({ type: "success", text: result.created ? "Attendance session opened." : "Existing attendance session loaded." });
      if (result.created) await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const collectAttendanceMarks = () => attendanceRoster.map(({ student, status }) => ({ studentId: student._id, status }));

  const handleSaveAttendance = async () => {
    if (!attendanceSession || attendanceRoster.some((row) => !row.status)) {
      setNotice({ type: "error", text: "Choose an attendance status for every student before saving." });
      return;
    }
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const result = await saveAttendanceMarks(attendanceSession._id, collectAttendanceMarks(), getSessionMarker());
      applyAttendanceResponse(result);
      setNotice({ type: "success", text: "Attendance draft saved." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizeAttendance = async () => {
    if (!attendanceSession || attendanceRoster.some((row) => !row.status)) {
      setNotice({ type: "error", text: "Choose an attendance status for every student before finalizing." });
      return;
    }
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const token = getSessionMarker();
      if (attendanceSession.status === "draft") await saveAttendanceMarks(attendanceSession._id, collectAttendanceMarks(), token);
      const result = await finalizeAttendanceSession(attendanceSession._id, token);
      applyAttendanceResponse(result);
      setConfirmFinalize(false);
      setNotice({ type: "success", text: "Attendance finalized and released to students." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCorrectAttendance = async () => {
    const reason = correctionReason.trim();
    const changed = attendanceRoster.filter((row) => row.status && row.status !== row.savedStatus);
    if (!reason) {
      setNotice({ type: "error", text: "Enter a reason for this correction." });
      return;
    }
    if (!changed.length) {
      setNotice({ type: "error", text: "Change at least one attendance status before submitting a correction." });
      return;
    }
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const marks = changed.map(({ student, status }) => ({ studentId: student._id, status }));
      const result = await correctAttendanceMarks(attendanceSession._id, reason, marks, getSessionMarker());
      applyAttendanceResponse(result);
      setCorrectionReason("");
      setNotice({ type: "success", text: "Correction saved with its reason and audit history." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="academic-management" id="academic-management-section" tabIndex={-1} aria-labelledby="academic-heading">
      <div className="academic-heading">
        <div>
          <span className="small-label">ACADEMIC SETUP</span>
          <h2 id="academic-heading">Courses & enrollment</h2>
          <p>Create course offerings and manage student enrollment records.</p>
        </div>
        <span className="academic-count">{enrollmentCounts.active} active enrollments</span>
      </div>

      {notice.text && <div className={`academic-notice ${notice.type}`} role="status">{notice.text}</div>}

      {!offerings.length && <div className="academic-notice" role="note">
        <strong>Start here:</strong> create a course offering first. Then choose an active student in the enrollment form below.
      </div>}

      <div className="academic-grid">
        <form className="academic-card" onSubmit={handleCreateOffering}>
          <h3>Create course offering</h3>
          <p>Step 1 of 2 · Add the course code, name, term, and section. Each combination must be unique.</p>
          <div className="academic-fields">
            <label>Course code<input required maxLength="24" value={offeringForm.courseCode} onChange={(e) => setOfferingForm({ ...offeringForm, courseCode: e.target.value })} placeholder="CS101" /></label>
            <label>Course name<input required maxLength="120" value={offeringForm.courseName} onChange={(e) => setOfferingForm({ ...offeringForm, courseName: e.target.value })} placeholder="Introduction to Computing" /></label>
            <label>Term<input required maxLength="60" value={offeringForm.term} onChange={(e) => setOfferingForm({ ...offeringForm, term: e.target.value })} placeholder="Fall 2026" /></label>
            <label>Section<input required maxLength="30" value={offeringForm.section} onChange={(e) => setOfferingForm({ ...offeringForm, section: e.target.value })} placeholder="A" /></label>
            <label>Start date<input type="date" value={offeringForm.startDate} onChange={(e) => setOfferingForm({ ...offeringForm, startDate: e.target.value })} /></label>
            <label>End date<input type="date" value={offeringForm.endDate} onChange={(e) => setOfferingForm({ ...offeringForm, endDate: e.target.value })} /></label>
          </div>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Create offering"}</button>
        </form>

        <form className="academic-card" onSubmit={handleEnroll}>
          <h3>Enroll a student</h3>
          <p>Step 2 of 2 · Select an active student and the offering created above.</p>
          <div className="academic-fields academic-fields-single">
            <label>Find student<input type="search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); setStudentPage(1); }} placeholder="Name, email, or student number" autoComplete="off" /></label>
            <label>Student<select required value={enrollmentForm.studentId} onChange={(e) => {
              const student = studentOptions.find((item) => item._id === e.target.value);
              setSelectedStudent(student || null);
              setEnrollmentForm({ ...enrollmentForm, studentId: e.target.value });
            }}>
              <option value="">Choose a student</option>
              {selectedStudent && !studentOptions.some((item) => item._id === selectedStudent._id) && <option value={selectedStudent._id}>{selectedStudent.name} · {selectedStudent.email}</option>}
              {studentOptions.map((student) => <option key={student._id} value={student._id}>{student.name} · {student.email}</option>)}
            </select></label>
            <label>Course offering<select required value={enrollmentForm.offeringId} onChange={(e) => setEnrollmentForm({ ...enrollmentForm, offeringId: e.target.value })}>
              <option value="">Choose a course</option>
              {offerings.map((offering) => <option key={offering._id} value={offering._id}>{offering.courseCode} · {offering.courseName} · {offering.term} / {offering.section}</option>)}
            </select></label>
          </div>
          <div className="academic-table-heading"><span className="academic-hint">{studentSearchLoading ? "Searching students…" : `${studentPagination.totalStudents || 0} active students · page ${studentPagination.currentPage || 1} of ${Math.max(studentPagination.totalPages || 1, 1)}`}</span><div><button type="button" className="secondary-button" disabled={studentSearchLoading || studentPage <= 1} onClick={() => setStudentPage((page) => Math.max(1, page - 1))}>Previous</button> <button type="button" className="secondary-button" disabled={studentSearchLoading || studentPage >= (studentPagination.totalPages || 1)} onClick={() => setStudentPage((page) => page + 1)}>Next</button></div></div>
          {studentSearchError && <p className="academic-hint" role="alert">{studentSearchError}</p>}
          <button className="primary-button" type="submit" disabled={saving || studentSearchLoading || !enrollmentForm.studentId || !offerings.length}>{saving ? "Saving…" : "Enroll student"}</button>
          {!studentSearchLoading && !studentSearchError && !studentPagination.totalStudents && <p className="academic-hint">No active students match this search.</p>}
          {!!studentPagination.totalStudents && !offerings.length && <p className="academic-hint">Create a course offering before enrolling.</p>}
        </form>
      </div>

      <div className="academic-card offering-lifecycle-card">
        <div className="academic-table-heading"><div><h3>Course offerings</h3><p>Archive a course after all active enrollments are withdrawn. Past academic records stay available.</p></div><span className="academic-count">{offerings.length} active · {archivedOfferings.length} archived</span></div>
        {!offerings.length && !archivedOfferings.length ? <p className="academic-hint">No course offerings created yet.</p> : <div className="academic-table-scroll"><table className="academic-table">
          <thead><tr><th>Course</th><th>Term</th><th>Section</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{[...offerings, ...archivedOfferings].map((offering) => <tr key={offering._id}>
            <td><strong>{offering.courseCode} · {offering.courseName}</strong></td><td>{offering.term}</td><td>{offering.section}</td><td>{offering.status === "active" ? "Active" : "Archived"}</td>
            <td>{offering.status === "active"
              ? <button type="button" className="academic-link-button" disabled={saving} onClick={() => setOfferingToArchive(offering)}>Archive</button>
              : <button type="button" className="academic-link-button" disabled={saving} onClick={() => setOfferingToRestore(offering)}>Restore</button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>

      <div className="academic-card academic-table-card">
        <div className="academic-table-heading">
          <div><h3>{enrollmentStatus === "active" ? "Active enrollments" : "Enrollment history"}</h3><p>{enrollmentCounts.active} active · {enrollmentCounts.withdrawn} withdrawn</p></div>
          <div className="enrollment-view-switch" role="group" aria-label="Enrollment view">
            <button type="button" className={enrollmentStatus === "active" ? "selected" : ""} aria-pressed={enrollmentStatus === "active"} onClick={() => { setEnrollmentStatus("active"); setEnrollmentPage(1); }}>Active</button>
            <button type="button" className={enrollmentStatus === "all" ? "selected" : ""} aria-pressed={enrollmentStatus === "all"} onClick={() => { setEnrollmentStatus("all"); setEnrollmentPage(1); }}>History</button>
          </div>
        </div>
        {enrollmentLoading ? <p className="academic-hint">Loading enrollments…</p> : enrollments.length === 0 ? <p className="academic-hint">{enrollmentStatus === "active" ? "No active enrollments yet." : "No enrollment history yet."}</p> : (
          <div className="academic-table-scroll"><table className="academic-table">
            <thead><tr><th>Student</th><th>Course</th><th>Term</th><th>Section</th><th>Enrolled</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{enrollments.map((item) => (
              <tr key={item._id}>
                <td><strong>{item.studentId?.name || "Archived student"}</strong><small>{item.studentId?.email || ""}</small></td>
                <td>{item.offeringId?.courseCode} · {item.offeringId?.courseName}</td>
                <td>{item.offeringId?.term}</td>
                <td>{item.offeringId?.section}</td>
                <td>{item.enrolledAt ? new Date(item.enrolledAt).toLocaleDateString() : "—"}</td>
                <td>{item.status === "active" ? "Active" : `Withdrawn${item.withdrawnAt ? ` · ${new Date(item.withdrawnAt).toLocaleDateString()}` : ""}`}</td>
                <td>{item.status === "active"
                  ? <button className="academic-link-button" type="button" disabled={saving} onClick={() => setEnrollmentToWithdraw(item)}>Withdraw</button>
                  : <button className="academic-link-button" type="button" disabled={saving || !item.studentId?._id || !item.offeringId?._id} onClick={() => handleReactivate(item)}>Reactivate</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {!enrollmentLoading && enrollmentPagination.totalPages > 1 && <div className="enrollment-pagination"><button type="button" className="secondary-button" disabled={enrollmentPage <= 1} onClick={() => setEnrollmentPage((page) => page - 1)}>Previous</button><span>Page {enrollmentPagination.currentPage} of {enrollmentPagination.totalPages}</span><button type="button" className="secondary-button" disabled={enrollmentPage >= enrollmentPagination.totalPages} onClick={() => setEnrollmentPage((page) => page + 1)}>Next</button></div>}
      </div>

      <section className="academic-card attendance-admin-card" aria-labelledby="attendance-admin-heading">
        <div className="academic-table-heading attendance-admin-heading">
          <div><h3 id="attendance-admin-heading">Take attendance</h3><p>Draft marks can be edited; finalized records require an audited correction.</p></div>
          {attendanceSession && <span className={`attendance-state ${attendanceSession.status}`}>{attendanceSession.status}</span>}
        </div>
        <form className="attendance-session-form" onSubmit={handleOpenAttendance}>
          <label>Course offering<select required value={attendanceOfferingId} onChange={(e) => setAttendanceOfferingId(e.target.value)}>
            <option value="">Choose a course</option>
            {offerings.map((offering) => <option key={offering._id} value={offering._id}>{offering.courseCode} · {offering.courseName} · {offering.term} / {offering.section}</option>)}
          </select></label>
          <label>Class date<input required type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} /></label>
          <button type="submit" className="secondary-button" disabled={saving || !offerings.length}>{saving ? "Loading…" : "Open class roster"}</button>
        </form>
        {attendanceSession && <>
          <div className="attendance-roster-meta">
            <strong>{attendanceSession.sessionDate}</strong>
            <span>{attendanceRoster.length} enrolled students</span>
          </div>
          {!attendanceRoster.length ? <p className="academic-hint">There are no active students enrolled in this offering.</p> : <div className="academic-table-scroll">
            <table className="academic-table attendance-roster-table">
              <thead><tr><th>Student</th><th>Attendance status</th></tr></thead>
              <tbody>{attendanceRoster.map((row) => <tr key={row.student._id}>
                <td><strong>{row.student.name}</strong><small>{row.student.email}</small></td>
                <td><select aria-label={`Attendance status for ${row.student.name}`} value={row.status} disabled={saving} onChange={(e) => setAttendanceRoster((current) => current.map((entry) => entry.student._id === row.student._id ? { ...entry, status: e.target.value } : entry))}>
                  <option value="">Choose status</option>
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="late">Late</option>
                  <option value="excused">Excused</option>
                </select></td>
              </tr>)}</tbody>
            </table>
          </div>}
          {attendanceSession.status === "draft" && <div className="attendance-actions">
            <button type="button" className="secondary-button" disabled={saving || !attendanceRoster.length} onClick={handleSaveAttendance}>Save draft</button>
            <button type="button" className="primary-button" disabled={saving || !attendanceRoster.length} onClick={() => setConfirmFinalize(true)}>Finalize & release</button>
          </div>}
          {attendanceSession.status === "finalized" && <div className="attendance-correction">
            <label>Correction reason<textarea maxLength="500" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} placeholder="Explain why the finalized attendance needs a correction" /></label>
            <button type="button" className="secondary-button" disabled={saving || !attendanceRoster.length} onClick={handleCorrectAttendance}>Save audited correction</button>
          </div>}
        </>}
      </section>
      <AssessmentManagement offerings={offerings} onSummaryRefresh={onSummaryRefresh} />
      {enrollmentToWithdraw && <ConfirmDialog
        title="Withdraw this enrollment?"
        message={`This removes ${enrollmentToWithdraw.studentId?.name || "the student"} from future active rosters. Existing attendance and results remain in academic history.`}
        confirmLabel="Withdraw enrollment"
        tone="danger"
        busy={saving}
        onCancel={() => setEnrollmentToWithdraw(null)}
        onConfirm={handleWithdraw}
      />}
      {confirmFinalize && <ConfirmDialog
        title="Finalize attendance?"
        message="The recorded attendance will be released to students. Future changes require an audited correction with a reason."
        confirmLabel="Finalize and release"
        busy={saving}
        onCancel={() => setConfirmFinalize(false)}
        onConfirm={handleFinalizeAttendance}
      />}
      {offeringToArchive && <ConfirmDialog
        title={`Archive ${offeringToArchive.courseCode}?`}
        message="The course offering will disappear from enrollment, attendance, and assessment selectors. It can only be archived after all active enrollments are withdrawn; prior academic records will be retained."
        confirmLabel="Archive offering"
        tone="danger"
        busy={saving}
        onCancel={() => setOfferingToArchive(null)}
        onConfirm={handleArchiveOffering}
      />}
      {offeringToRestore && <ConfirmDialog
        title={`Restore ${offeringToRestore.courseCode}?`}
        message="The course offering becomes available for new attendance, assessments, and enrollments again. Existing withdrawn enrollments stay unchanged."
        confirmLabel="Restore offering"
        busy={saving}
        onCancel={() => setOfferingToRestore(null)}
        onConfirm={handleRestoreOffering}
      />}
    </section>
  );
}

export default AcademicManagement;
