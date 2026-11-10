import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { getSessionMarker } from "../sessionState";

import StudentTable from "./StudentTable";
import StudentForm from "./StudentForm";
import StudentCsvImport from "./StudentCsvImport";
import AcademicManagement from "./AcademicManagement";
import ConfirmDialog from "./ConfirmDialog";
import logo from "../assets/student management logo.png";

import {
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  restoreStudent,
  createStudentInvitation,
  createStudentPasswordReset,
  setStudentAccountStatus,
  getAcademicSetup,
  getDashboardSummary,
  downloadAcademicReport,
  getAuditEvents,
} from "../api";

const auditEventLabels = {
  academic_export: "Data export",
  account_password_changed: "Account password changed",
  student_created: "Student record created",
  student_updated: "Student record updated",
  students_imported: "Students imported",
  student_invitation_created: "Student invitation issued",
  student_password_reset_issued: "Password reset link issued",
  student_password_reset_completed: "Password reset completed",
  student_account_disabled: "Student account disabled",
  student_account_reactivated: "Student account reactivated",
  student_account_linked: "Student account linked",
  student_archived: "Student archived",
  student_restored: "Student restored",
  offering_archived: "Offering archived",
  offering_restored: "Offering restored",
  enrollment_created: "Student enrolled",
  legacy_enrollment_created: "Legacy enrollment migrated",
  enrollment_reactivated: "Enrollment reactivated",
  enrollment_withdrawn: "Enrollment withdrawn",
  assessment_published: "Assessment results published",
  attendance_finalized: "Attendance finalized",
};


// =========================
// ADMIN DASHBOARD
// =========================

function AdminDashboard({ onLogout }) {

  // =========================
  // STATES
  // =========================

  const [activeView, setActiveView] = useState("overview");
  const [students, setStudents] = useState([]);
  const [courseOptions, setCourseOptions] = useState([]);

  const [search, setSearch] = useState("");

  const [course, setCourse] = useState("All");

  const [sort, setSort] = useState("name");

  const [page, setPage] = useState(1);
  const [studentStatus, setStudentStatus] = useState("active");

  const [limit] = useState(20);

  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalStudents: 0,
    limit: 20,
  });

  const [showForm, setShowForm] = useState(false);

  const [editingStudent, setEditingStudent] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [invitation, setInvitation] = useState(null);
  const [passwordReset, setPasswordReset] = useState(null);
  const [invitingStudent, setInvitingStudent] = useState(false);
  const [resettingStudentId, setResettingStudentId] = useState("");
  const [formError, setFormError] = useState("");
  const [studentFormSaving, setStudentFormSaving] = useState(false);
  const [studentToArchive, setStudentToArchive] = useState(null);
  const [studentToResetPassword, setStudentToResetPassword] = useState(null);
  const [archivingStudentId, setArchivingStudentId] = useState("");
  const [studentToRestore, setStudentToRestore] = useState(null);
  const [restoringStudentId, setRestoringStudentId] = useState("");
  const [accountStatusToChange, setAccountStatusToChange] = useState(null);
  const [updatingAccountStudentId, setUpdatingAccountStudentId] = useState("");
  const [rosterSuccess, setRosterSuccess] = useState("");
  const [reportFilters, setReportFilters] = useState({ type: "attendance", offeringId: "", from: "", to: "" });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportNotice, setReportNotice] = useState({ type: "", text: "" });
  const [reportOfferings, setReportOfferings] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditPagination, setAuditPagination] = useState({ currentPage: 1, totalPages: 0, totalRecords: 0 });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const auditRequestSequence = useRef(0);
  const archiveTriggerRef = useRef(null);
  const studentRequestSequence = useRef(0);

  const refreshSummary = useCallback(async () => {
    try {
      const token = getSessionMarker();
      if (!token) return;
      const [summaryResult, offeringsResult] = await Promise.allSettled([getDashboardSummary(token), getAcademicSetup(token)]);
      if (summaryResult.status === "fulfilled") {
        setDashboardSummary(summaryResult.value);
        setSummaryError("");
      } else {
        setSummaryError(summaryResult.reason.message || "Unable to load dashboard metrics.");
      }
      if (offeringsResult.status === "fulfilled") setReportOfferings(offeringsResult.value.offerings || []);
    } catch (summaryLoadError) {
      setSummaryError(summaryLoadError.message || "Unable to load dashboard metrics.");
    }
  }, []);

  const handleReportDownload = async (event) => {
    event.preventDefault();
    setReportLoading(true);
    setReportNotice({ type: "", text: "" });
    try {
      const blob = await downloadAcademicReport(reportFilters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `studenthub-${reportFilters.type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReportNotice({ type: "success", text: "Report downloaded. It contains finalized attendance or published results only." });
    } catch (reportError) {
      setReportNotice({ type: "error", text: reportError.message || "Unable to download the report." });
    } finally {
      setReportLoading(false);
    }
  };

  const loadAuditEvents = async (requestedPage = 1) => {
    const requestSequence = ++auditRequestSequence.current;
    setAuditLoading(true);
    setAuditError("");
    try {
      const result = await getAuditEvents(getSessionMarker(), requestedPage);
      if (requestSequence !== auditRequestSequence.current) return;
      setAuditEvents(result.events || []);
      setAuditPagination(result.pagination || { currentPage: 1, totalPages: 0, totalRecords: 0 });
    } catch (auditLoadError) {
      if (requestSequence === auditRequestSequence.current) setAuditError(auditLoadError.message || "Unable to load the audit trail.");
    } finally {
      if (requestSequence === auditRequestSequence.current) setAuditLoading(false);
    }
  };

  const refreshSummaryOnMount = useEffectEvent(() => refreshSummary());
  useEffect(() => {
    const timer = window.setTimeout(refreshSummaryOnMount, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // =========================
  // LOAD STUDENTS
  // =========================

  const loadStudents = useCallback(async (currentPage = page, currentStatus = studentStatus, filterOverrides = {}) => {
    const requestSequence = ++studentRequestSequence.current;
    try {
      setLoading(true);
      setError("");

      const token =
        getSessionMarker();

      if (!token) {
        if (requestSequence === studentRequestSequence.current) {
          setError("Your session has expired. Please login again.");
        }
        return false;
      }

      const data = await getStudents(
        token,
        currentPage,
        limit,
        { search, course, sort, status: currentStatus, ...filterOverrides }
      );
      if (requestSequence !== studentRequestSequence.current) return false;

      const totalPages = data?.pagination?.totalPages || 0;
      if (currentPage > Math.max(1, totalPages)) {
        const fallbackPage = Math.max(1, totalPages);
        if (currentPage !== fallbackPage) setPage(fallbackPage);
        return false;
      }

      // IMPORTANT:
      // Backend pagination returns an object:
      // {
      //   students: [],
      //   pagination: {}
      // }

      const studentList = Array.isArray(
        data?.students
      )
        ? data.students
        : [];

      setStudents(studentList);
      setCourseOptions(data?.availableCourses || []);

      setPagination({
        currentPage:
          data?.pagination?.currentPage ||
          currentPage,

        totalPages:
          data?.pagination?.totalPages ||
          1,

        totalStudents:
          data?.pagination?.totalStudents ||
          0,

        limit:
          data?.pagination?.limit ||
          limit,
      });
      return true;

    } catch (err) {

      if (requestSequence !== studentRequestSequence.current) return false;

      console.error(
        "Load students error:",
        err
      );

      setStudents([]);

      setError(
        err.message ||
          "Failed to load students."
      );
      return false;

    } finally {
      if (requestSequence === studentRequestSequence.current) setLoading(false);
    }
  }, [page, limit, search, course, sort, studentStatus]);


  // =========================
  // INITIAL LOAD
  // =========================

  useEffect(() => {
    const timer = setTimeout(() => loadStudents(page), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadStudents, page, search]);

  const filteredStudents = students;
  const courses = courseOptions;


  // =========================
  // ADD / UPDATE STUDENT
  // =========================

  const handleSave = async (
    studentData
  ) => {
    if (studentFormSaving) return;
    setStudentFormSaving(true);
    try {

      const token =
        getSessionMarker();

      if (!token) {
        setFormError("Your session has expired. Please sign in again.");
        return;
      }


      // =========================
      // UPDATE
      // =========================

      if (editingStudent) {

        await updateStudent(
          editingStudent._id,
          studentData,
          token
        );

        // Reload current page
        await loadStudents(page);

      }

      // =========================
      // ADD
      // =========================

      else {

        await addStudent(
          studentData,
          token
        );

        // New record can change
        // pagination.
        setPage(1);

        setStudentStatus("active");
        await loadStudents(1, "active");
      }


      setShowForm(false);

      setEditingStudent(null);
      setFormError("");
      await refreshSummary();

    } catch (err) {

      console.error(
        "Save student error:",
        err
      );

      setFormError(err.message || "Could not save student.");
    } finally {
      setStudentFormSaving(false);
    }
  };

  const handleStudentsImported = async (count) => {
    setError("");
    setStudentStatus("active");
    setSearch("");
    setCourse("All");
    setPage(1);
    setRosterSuccess(`${count} student records imported successfully.`);
    await Promise.all([
      loadStudents(1, "active", { search: "", course: "All" }),
      refreshSummary(),
    ]);
  };


  // =========================
  // EDIT
  // =========================

  const handleEdit = (student) => {

    setEditingStudent(student);
    setFormError("");

    setShowForm(true);
  };

  const handleRestore = async () => {
    if (!studentToRestore) return;
    setRestoringStudentId(studentToRestore._id);
    setError("");
    setRosterSuccess("");
    try {
      await restoreStudent(studentToRestore._id, getSessionMarker());
      setStudentToRestore(null);
      const [listLoaded] = await Promise.all([loadStudents(page, "archived"), refreshSummary()]);
      if (listLoaded) setRosterSuccess("Student restored. Enrollments remain withdrawn; re-enroll the student in the required course offerings.");
    } catch (restoreError) {
      setError(restoreError.message || "Unable to restore student.");
    } finally {
      setRestoringStudentId("");
    }
  };

  const handleInvite = async (student) => {
    setInvitation(null);
    setInvitingStudent(true);
    try {
      const result = await createStudentInvitation(student._id, getSessionMarker());
      setInvitation({ student, ...result.invitation, delivery: result.delivery?.status || "not_configured" });
      const rosterLoaded = await loadStudents(page, studentStatus);
      if (!rosterLoaded) setRosterSuccess("Invitation created. The roster status could not refresh; reload the page to see it.");
    } catch (inviteError) {
      setError(inviteError.message || "Unable to create an invitation.");
    } finally {
      setInvitingStudent(false);
    }
  };

  const handlePasswordReset = async () => {
    const student = studentToResetPassword;
    if (!student) return;
    setPasswordReset(null);
    setResettingStudentId(student._id);
    setError("");
    setRosterSuccess("");
    try {
      const result = await createStudentPasswordReset(student._id, getSessionMarker());
      setPasswordReset({ student, ...result.reset, delivery: result.delivery?.status || "not_configured" });
      const rosterLoaded = await loadStudents(page, studentStatus);
      if (!rosterLoaded) setRosterSuccess("Reset link created. Reload the roster if its account link status needs refreshing.");
    } catch (resetError) {
      setError(resetError.message || "Unable to issue a password reset link.");
    } finally {
      setResettingStudentId("");
      setStudentToResetPassword(null);
    }
  };

  const handleAccountStatusChange = async () => {
    if (!accountStatusToChange) return;
    const { student, active } = accountStatusToChange;
    setUpdatingAccountStudentId(student._id);
    setError("");
    setRosterSuccess("");
    try {
      const result = await setStudentAccountStatus(student._id, active, getSessionMarker());
      setAccountStatusToChange(null);
      const loaded = await loadStudents(page, studentStatus);
      setRosterSuccess(loaded ? result.message : `${result.message} Reload the roster to see the updated status.`);
    } catch (accountStatusError) {
      setError(accountStatusError.message || "Unable to update student account access.");
    } finally {
      setUpdatingAccountStudentId("");
    }
  };


  // =========================
  // DELETE
  // =========================

  const handleDelete = async () => {
    if (!studentToArchive || archivingStudentId) return;
    const studentId = studentToArchive._id || studentToArchive.id;
    setArchivingStudentId(studentId);

    try {

      const token =
        getSessionMarker();

      if (!token) {
        setError("Your session has expired. Please sign in again.");
        return;
      }


      await deleteStudent(
        studentId,
        token
      );
      const trigger = archiveTriggerRef.current;
      setStudentToArchive(null);
      await refreshSummary();

      const nextPage = students.length === 1 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      await loadStudents(nextPage);
      if (trigger) requestAnimationFrame(() => document.getElementById("student-management-section")?.focus());

    } catch (err) {

      console.error(
        "Delete student error:",
        err
      );

      setError(err.message || "Could not archive student.");
    } finally {
      setArchivingStudentId("");
    }
  };


  // =========================
  // RESET FILTERS
  // =========================

  const resetFilters = () => {

    setSearch("");

    setCourse("All");

    setSort("name");

    setPage(1);
  };

  const setupProgress = dashboardSummary ? [
    { id: "students", title: "Add your first student", detail: "Create a student record or import a roster.", done: dashboardSummary.totalStudents > 0, target: "student-management-section" },
    { id: "offerings", title: "Create a course offering", detail: "Set a course, term, and section.", done: dashboardSummary.activeOfferings > 0, target: "academic-management-section" },
    { id: "enrollment", title: "Enroll a student", detail: "Add a student to an active course offering.", done: dashboardSummary.activeEnrollments > 0, target: "academic-management-section" },
  ] : [];
  const setupCompleted = setupProgress.filter((step) => step.done).length;
  const showSetupGuide = Boolean(dashboardSummary) && setupCompleted < setupProgress.length;

  const openSetupStep = (step) => {
    setActiveView(step.id === "students" ? "students" : "academics");
    if (step.id === "students" && !step.done) {
      setEditingStudent(null);
      setFormError("");
      setShowForm(true);
      return;
    }
    window.setTimeout(() => document.getElementById(step.target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };


  // =========================
  // RENDER
  // =========================

  return (

    <div className="admin-layout admin-layout-with-sidebar">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-heading"><span className="admin-sidebar-mark" aria-hidden="true">S</span><div><strong>StudentHub</strong><small>Workspace</small></div></div>
        <span className="admin-sidebar-label">WORKSPACE</span>
        <nav className="admin-sidebar-nav" aria-label="Admin navigation">
          {[
            { id: "overview", label: "Overview", icon: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-7h6v7" /></> },
            { id: "reports", label: "Reports", icon: <><path d="M4 3h12l4 4v14H4z" /><path d="M15 3v5h5M8 13h8M8 17h8" /></> },
            { id: "audit", label: "Audit trail", icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
            { id: "academics", label: "Academics", icon: <><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 0 3 23z" /><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5a2.5 2.5 0 0 1 2.5 2z" /></> },
            { id: "students", label: "Students", icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></> },
          ].map((item) => <button key={item.id} type="button" className={`admin-sidebar-link${activeView === item.id ? " active" : ""}`} aria-current={activeView === item.id ? "page" : undefined} onClick={() => { setActiveView(item.id); if (item.id === "audit" && !auditEvents.length) loadAuditEvents(1); }}>
            <svg className="admin-sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{item.icon}</svg><span>{item.label}</span>
          </button>)}
        </nav>
        <div className="admin-sidebar-footer">Administration<br /><span>Student records &amp; academics</span></div>
      </aside>
      <div className="admin-main-column">


      {/* =========================
          HEADER
      ========================= */}

      <header className="admin-header">

        <div className="brand-small">

          <div className="logo-icon">
          <img src={logo} alt="StudentHub Logo" />
          </div>
          <div>

            <strong>
              StudentHub
            </strong>

            <small>
              Admin Portal
            </small>

          </div>

        </div>


        <button
          className="logout-button"
          onClick={onLogout}
        >
          Logout
        </button>

      </header>


      {/* =========================
          MAIN
      ========================= */}

      <main className="admin-content">

        {/* =========================
            WELCOME
        ========================= */}

        {activeView === "overview" && <>
        <section className="admin-welcome">

          <div>

            <span className="small-label">
              ADMIN DASHBOARD
            </span>

            <h1>
              Welcome back, Admin 👋
            </h1>

            <p>
              Manage students and monitor
              their academic performance.
            </p>

          </div>


          <button
            className="primary-button admin-add-student"
            onClick={() => {

              setEditingStudent(null);
              setFormError("");

              setShowForm(true);

            }}
          >
            + Add Student
          </button>

        </section>


        {/* =========================
            ERROR
        ========================= */}

        {error && <div className="admin-error-notice" role="alert">{error}</div>}


        {/* =========================
            STATS
        ========================= */}

        <section className="admin-stats" id="dashboard-overview" aria-label="School overview">
          <div className="admin-stat">
            <div className="stat-icon">
              👨‍🎓
            </div>
            <span>Active Students</span>
            <strong>{dashboardSummary?.totalStudents ?? "—"}</strong>
            <small>Non-archived student records</small>
          </div>
          <div className="admin-stat">
            <div className="stat-icon">
              📚
            </div>
            <span>Active Offerings</span>
            <strong>{dashboardSummary?.activeOfferings ?? "—"}</strong>
            <small>Course, term, and section</small>
          </div>
          <div className="admin-stat">
            <div className="stat-icon">
              👥
            </div>
            <span>Active Enrollments</span>
            <strong>{dashboardSummary?.activeEnrollments ?? "—"}</strong>
            <small>Across all active offerings</small>
          </div>
          <div className="admin-stat">
            <div className="stat-icon">
              📅
            </div>
            <span>Attendance Rate</span>
            <strong>{dashboardSummary?.attendance?.rate == null ? "—" : `${dashboardSummary.attendance.rate}%`}</strong>
            <small>{dashboardSummary?.attendance?.countedSessions ?? 0} recorded, finalized marks</small>
          </div>
          <div className="admin-stat">
            <div className="stat-icon">📝</div>
            <span>Average Published Score</span>
            <strong>{dashboardSummary?.assessments?.averageScorePercent == null ? "—" : `${dashboardSummary.assessments.averageScorePercent}%`}</strong>
            <small>Normalized per assessment; not a course grade</small>
          </div>
          <div className="admin-stat">
            <div className="stat-icon">⏳</div>
            <span>Items to Review</span>
            <strong>{dashboardSummary ? dashboardSummary.pendingAttendanceSessions + dashboardSummary.assessments.draftCount : "—"}</strong>
            <small>{dashboardSummary?.pendingAttendanceSessions ?? 0} attendance · {dashboardSummary?.assessments?.draftCount ?? 0} assessment drafts</small>
          </div>
        </section>
        {showSetupGuide && <section className="admin-setup-guide" aria-labelledby="admin-setup-title">
          <div className="admin-setup-heading">
            <div>
              <span className="small-label">GETTING STARTED</span>
              <h2 id="admin-setup-title">Set up your student workspace</h2>
              <p>Complete these steps to begin managing academic records.</p>
            </div>
            <span className="admin-setup-progress">{setupCompleted} of {setupProgress.length} complete</span>
          </div>
          <ol className="admin-setup-steps">
            {setupProgress.map((step, index) => <li className={step.done ? "complete" : ""} key={step.id}>
              <span className="admin-setup-step-number" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
              <div className="admin-setup-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></div>
              <button type="button" className="secondary-button" onClick={() => openSetupStep(step)}>{step.done ? "Manage" : "Start"}</button>
            </li>)}
          </ol>
        </section>}
        <p className="dashboard-data-scope">Dashboard totals include all non-archived students, active offerings/enrollments, finalized attendance marks, and published assessment results. Attendance rate counts present and late marks; excused marks are excluded. Published score average normalizes each score to that assessment maximum and is not a course grade. Snapshot generated {dashboardSummary?.generatedAt ? new Date(dashboardSummary.generatedAt).toLocaleString() : "—"}.</p>
        {summaryError && <p className="dashboard-summary-error" role="status">Dashboard metrics: {summaryError}</p>}

        </>}

        {activeView === "reports" && <section className="report-export-card" aria-labelledby="report-export-title">
          <div><h2 id="report-export-title">Academic reports</h2><p>Download finalized attendance or published assessment results as CSV. Draft records and private feedback are excluded.</p></div>
          <form className="report-export-form" onSubmit={handleReportDownload}>
            <label>Report type<select value={reportFilters.type} onChange={(event) => setReportFilters({ ...reportFilters, type: event.target.value })}><option value="attendance">Finalized attendance</option><option value="results">Published results</option></select></label>
            <label>Course offering<select value={reportFilters.offeringId} onChange={(event) => setReportFilters({ ...reportFilters, offeringId: event.target.value })}><option value="">All offerings</option>{reportOfferings.map((item) => <option key={item._id} value={item._id}>{item.courseCode} · {item.term} / {item.section}</option>)}</select></label>
            <label>{reportFilters.type === "attendance" ? "Session date from" : "Published from"}<input type="date" value={reportFilters.from} onChange={(event) => setReportFilters({ ...reportFilters, from: event.target.value })} /></label>
            <label>{reportFilters.type === "attendance" ? "Session date to" : "Published to"}<input type="date" value={reportFilters.to} onChange={(event) => setReportFilters({ ...reportFilters, to: event.target.value })} /></label>
            <button className="secondary-button" type="submit" disabled={reportLoading}>{reportLoading ? "Preparing report…" : "Download CSV"}</button>
          </form>
          {reportNotice.text && <p className={`report-feedback ${reportNotice.type}`} role={reportNotice.type === "error" ? "alert" : "status"}>{reportNotice.text}</p>}
          <small>Exports are limited to 20,000 rows. Narrow the date range or choose one offering for larger datasets.</small>
        </section>}

        {activeView === "audit" && <section className="audit-trail-card" aria-labelledby="audit-trail-title">
          <div className="audit-trail-heading">
          <div><h2 id="audit-trail-title">Audit trail</h2><p>Review student account, archive/restore, grade correction, and academic data events.</p></div>
            <div className="audit-trail-actions">
            <button type="button" className="secondary-button" disabled={auditLoading} onClick={() => loadAuditEvents(auditPagination.currentPage || 1)}>{auditLoading ? "Refreshing…" : "Refresh"}</button>
            </div>
          </div>
          {<>
            {auditError && <p className="report-feedback error" role="alert">{auditError}</p>}
            {auditLoading ? <p className="academic-hint">Loading audit events…</p> : !auditEvents.length ? <p className="academic-hint">No audit events recorded yet.</p> : <div className="academic-table-scroll">
              <table className="academic-table audit-trail-table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Record / report</th><th>Filters</th><th>Rows</th></tr></thead>
                <tbody>{auditEvents.map((event, index) => <tr key={`${event.createdAt}-${index}`}>
                  <td>{event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"}</td>
                  <td>{auditEventLabels[event.eventType] || "Other event"}</td>
                  <td><strong>{event.actor?.name || "Unknown account"}</strong><small>{event.actor?.email || ""}</small></td>
                  <td>{event.eventType === "academic_export" ? event.reportType === "attendance" ? "Attendance report" : "Published results" : event.eventType === "students_imported" ? "CSV roster import" : event.eventType === "account_password_changed" ? "Account credentials" : event.student ? <><strong>{event.student.name || "Student record"}</strong><small>{event.student.email || ""}</small>{event.changedFields?.length > 0 && <small>Fields: {event.changedFields.join(", ")}</small>}</> : event.assessment ? <><strong>{event.assessment.title}</strong><small>{event.assessment.type} · maximum {event.assessment.maxScore}</small></> : event.attendanceSession ? <><strong>Attendance session</strong><small>{event.attendanceSession.sessionDate}</small></> : event.offering ? <><strong>{event.offering.courseCode} · {event.offering.courseName}</strong><small>{event.offering.term} / {event.offering.section}</small></> : "Academic record"}</td>
                  <td>{event.eventType === "academic_export" ? <>{event.offering ? `${event.offering.courseCode} · ${event.offering.term} / ${event.offering.section}` : "All offerings"}<small>{event.from || "Start"} – {event.to || "Now"} · dates in UTC</small></> : "—"}</td>
                  <td>{event.eventType === "academic_export" || event.eventType === "students_imported" || event.eventType === "assessment_published" || event.eventType === "attendance_finalized" ? event.rowCount : "—"}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {auditPagination.totalPages > 1 && <div className="enrollment-pagination"><button type="button" className="secondary-button" disabled={auditLoading || auditPagination.currentPage <= 1} onClick={() => loadAuditEvents(auditPagination.currentPage - 1)}>Previous</button><span>Page {auditPagination.currentPage} of {auditPagination.totalPages} · {auditPagination.totalRecords} events</span><button type="button" className="secondary-button" disabled={auditLoading || auditPagination.currentPage >= auditPagination.totalPages} onClick={() => loadAuditEvents(auditPagination.currentPage + 1)}>Next</button></div>}
          </>}
        </section>}


        {/* =========================
            STUDENT MANAGEMENT
        ========================= */}

        {activeView === "students" && <>
        <section className="student-management" id="student-management-section" tabIndex={-1}>

          <div className="student-status-switch" role="group" aria-label="Student record status">
            <button type="button" className={studentStatus === "active" ? "selected" : ""} aria-pressed={studentStatus === "active"} onClick={() => { setStudentStatus("active"); setCourse("All"); setPage(1); setRosterSuccess(""); }}>Active students</button>
            <button type="button" className={studentStatus === "archived" ? "selected" : ""} aria-pressed={studentStatus === "archived"} onClick={() => { setStudentStatus("archived"); setCourse("All"); setPage(1); setRosterSuccess(""); }}>Archived records</button>
          </div>

          <div className="management-header">

            <div>

              <h2>
                {studentStatus === "active" ? "Student Management" : "Archived student records"}
              </h2>

              <p>
                Search, filter, sort and
                manage student records.
              </p>

            </div>

            <button type="button" className="primary-button admin-add-student" onClick={() => {
              setEditingStudent(null);
              setFormError("");
              setShowForm(true);
            }}>
              + Add Student
            </button>

          </div>

          {studentStatus === "active" && <StudentCsvImport onImported={handleStudentsImported} />}


          {/* =========================
              FILTERS
          ========================= */}

          <div className="student-filters">


            {/* SEARCH */}

            <div className="search-box">

              🔍

              <input
                type="search"
                aria-label="Search students by name, email, or student number"
                placeholder={
                  "Search name, email, or student number..."
                }
                value={search}
                onChange={(e) => {

                  setSearch(
                    e.target.value
                  );

                  setPage(1);

                }}
              />

            </div>


            {/* COURSE */}

            <select
              value={course}
              onChange={(e) => {

                setCourse(
                  e.target.value
                );

                setPage(1);

              }}
            >

              <option value="All">
                All Courses
              </option>


              {courses.map(
                (item) => (

                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>

                )
              )}
            </select>


            {/* SORT */}

            <select
              value={sort}
              onChange={(e) =>
                setSort(
                  e.target.value
                )
              }
            >

              <option value="name">
                Sort by Name
              </option>

              <option value="attendance">
                Sort by Attendance
              </option>

            </select>


            {/* RESET */}

            <button
              type="button"
              className="cancel-button"
              onClick={
                resetFilters
              }
            >
              Reset
            </button>

          </div>


          {rosterSuccess && <p className="roster-success-notice" role="status">{rosterSuccess}</p>}

          {/* =========================
              STUDENT LIST
          ========================= */}

          {loading ? (

            <div className="empty-state">

              <h3>
                Loading students...
              </h3>

              <p>
                Please wait.
              </p>

            </div>

          ) : (

            <>

              {filteredStudents.length === 0 ? (

                <div className="empty-state">

                  <h3>
                    No students found
                  </h3>

                  <p>
                    Try changing your search
                    or filter.
                  </p>

                </div>

              ) : (

                <StudentTable
                  students={
                    filteredStudents
                  }
                  onEdit={
                    handleEdit
                  }
                  onDelete={
                    (studentId) => {
                      archiveTriggerRef.current = document.activeElement;
                      setStudentToArchive(students.find((item) => (item._id || item.id) === studentId) || { _id: studentId });
                    }
                  }
                  onInvite={handleInvite}
                  inviteDisabled={invitingStudent}
                  onAccountStatusChange={(student, active) => setAccountStatusToChange({ student, active })}
                  accountStatusBusy={Boolean(updatingAccountStudentId)}
                  onPasswordReset={setStudentToResetPassword}
                  passwordResetDisabled={Boolean(resettingStudentId)}
                  status={studentStatus}
                  onRestore={(student) => setStudentToRestore(student)}
                  archiveDisabled={Boolean(archivingStudentId)}
                />

              )}


              {/* =========================
                  PAGINATION
              ========================= */}

              {pagination.totalStudents >
                0 && (

                <div className="pagination">

                  <button
                    className="pagination-button"
                    type="button"
                    disabled={
                      loading || page <= 1
                    }
                    onClick={() =>
                      setPage(
                        page - 1
                      )
                    }
                  >
                    ← Previous
                  </button>


                  <div className="page-number">

                    Page{" "}
                    <strong>
                      {pagination.currentPage}
                    </strong>{" "}

                    of{" "}

                    <strong>
                      {pagination.totalPages}
                    </strong>

                  </div>


                  <button
                    className="pagination-button"
                    type="button"
                    disabled={
                      loading || page >=
                      pagination.totalPages
                    }
                    onClick={() =>
                      setPage(
                        page + 1
                      )
                    }
                  >
                    Next →
                  </button>

                </div>

              )}

            </>

          )}

        </section>

        </>}

        {activeView === "academics" && <AcademicManagement onSummaryRefresh={refreshSummary} />}

      </main>
      </div>


      {/* =========================
          ADD / EDIT FORM
      ========================= */}

      {showForm && (

        <StudentForm
          key={editingStudent?._id || "new-student"}
          saving={studentFormSaving}
          student={
            editingStudent
          }
          error={formError}
          onError={setFormError}

          onClose={() => {

            setShowForm(false);

            setEditingStudent(
              null
            );

          }}

          onSave={
            handleSave
          }
        />

      )}

      {invitation && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInvitation(null); }}>
        <section className="modal invitation-modal" role="dialog" aria-modal="true" aria-labelledby="invitation-title">
          <div className="modal-header"><div><h2 id="invitation-title">Student invitation created</h2><p>{invitation.delivery === "sent" ? `Activation email sent to ${invitation.student.email}.` : invitation.delivery === "queued" ? `Activation email queued for ${invitation.student.email}; delivery will retry automatically if SMTP is temporarily unavailable.` : "SMTP is not configured. Share this one-time link through the institution's approved channel."} The link expires {new Date(invitation.expiresAt).toLocaleString()}.</p></div></div>
          <label className="invitation-link-label">Activation link<input readOnly value={invitation.link} onFocus={(event) => event.target.select()} /></label>
          <p className="academic-hint">The link can be used once. Reissuing an invitation invalidates this link.</p>
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setInvitation(null)}>Close</button><button type="button" className="primary-button" onClick={() => navigator.clipboard.writeText(invitation.link).then(() => setInvitation((current) => ({ ...current, copied: true }))).catch(() => setInvitation((current) => ({ ...current, copied: false })))}>{invitation.copied ? "Copied" : invitation.copied === false ? "Copy failed" : "Copy invitation link"}</button></div>
        </section>
      </div>}

      {passwordReset && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasswordReset(null); }}>
        <section className="modal invitation-modal" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
          <div className="modal-header"><div><h2 id="password-reset-title">Password reset link issued</h2><p>{passwordReset.delivery === "sent" ? `Email sent to ${passwordReset.student.email}.` : passwordReset.delivery === "queued" ? `Reset email queued for ${passwordReset.student.email}; delivery will retry automatically if SMTP is temporarily unavailable.` : "SMTP is not configured. Identity verification was confirmed before issue; share the link through the institution's approved channel."} It expires {new Date(passwordReset.expiresAt).toLocaleString()}.</p></div></div>
          <label className="invitation-link-label">One-time reset link<input readOnly value={passwordReset.link} onFocus={(event) => event.target.select()} /></label>
          <p className="academic-hint">Issuing another link invalidates this one. Resetting the password signs out all existing sessions; the account's active/disabled status does not change.</p>
          <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setPasswordReset(null)}>Close</button><button type="button" className="primary-button" onClick={() => navigator.clipboard.writeText(passwordReset.link).then(() => setPasswordReset((current) => ({ ...current, copied: true }))).catch(() => setPasswordReset((current) => ({ ...current, copied: false })))}>{passwordReset.copied ? "Copied" : passwordReset.copied === false ? "Copy failed" : "Copy reset link"}</button></div>
        </section>
      </div>}

      {invitingStudent && <div className="invitation-progress" role="status">Creating secure invitation…</div>}
      {resettingStudentId && <div className="invitation-progress" role="status">Creating password reset link…</div>}

      {studentToResetPassword && <ConfirmDialog
        title={`Verify ${studentToResetPassword.name}'s identity before reset?`}
        message={`Continue only after you have verified ${studentToResetPassword.name}'s identity through the institution's approved process. This will email a one-time 30-minute reset link to ${studentToResetPassword.email} when SMTP is configured, and invalidate any earlier reset link.`}
        confirmLabel="Verified — issue reset"
        busy={resettingStudentId === studentToResetPassword._id}
        onCancel={() => setStudentToResetPassword(null)}
        onConfirm={handlePasswordReset}
      />}

      {studentToArchive && <ConfirmDialog
        title={`Archive ${studentToArchive.name || "this student"}?`}
        message="Their account access will be disabled and active enrollments withdrawn. The student record, grades, attendance, and enrollment history will remain available to administrators."
        confirmLabel="Archive student"
        tone="danger"
        busy={archivingStudentId === (studentToArchive._id || studentToArchive.id)}
        onCancel={() => {
          setStudentToArchive(null);
          requestAnimationFrame(() => archiveTriggerRef.current?.isConnected
            ? archiveTriggerRef.current.focus()
            : document.getElementById("student-management-section")?.focus());
        }}
        onConfirm={handleDelete}
      />}
      {studentToRestore && <ConfirmDialog
        title={`Restore ${studentToRestore.name}?`}
        message="This reactivates the student record and linked account. Previous sessions remain revoked; withdrawn enrollments stay withdrawn and must be re-enrolled separately."
        confirmLabel="Restore student"
        busy={restoringStudentId === studentToRestore._id}
        onCancel={() => setStudentToRestore(null)}
        onConfirm={handleRestore}
      />}
      {accountStatusToChange && <ConfirmDialog
        title={`${accountStatusToChange.active ? "Reactivate" : "Disable"} ${accountStatusToChange.student.name}'s account?`}
        message={accountStatusToChange.active
          ? "This will allow the student to sign in again. Previously revoked sessions will stay invalid."
          : "This immediately blocks sign-in and revokes the student's existing sessions. Their student record, enrollments, attendance, and results remain unchanged."}
        confirmLabel={accountStatusToChange.active ? "Reactivate account" : "Disable account"}
        tone={accountStatusToChange.active ? "primary" : "danger"}
        busy={updatingAccountStudentId === accountStatusToChange.student._id}
        onCancel={() => setAccountStatusToChange(null)}
        onConfirm={handleAccountStatusChange}
      />}

    </div>
  );
}

export default AdminDashboard;
