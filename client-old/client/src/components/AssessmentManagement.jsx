import { useEffect, useRef, useState } from "react";
import { getSessionMarker } from "../sessionState";
import ConfirmDialog from "./ConfirmDialog";
import {
  correctPublishedGrades,
  createAssessment,
  getAssessment,
  getAssessmentHistory,
  getAssessments,
  publishAssessment,
  saveDraftGrades,
} from "../api";

const emptyForm = { title: "", type: "assignment", maxScore: "100", dueDate: "", weight: "" };

function AssessmentManagement({ offerings, onSummaryRefresh }) {
  const [offeringId, setOfferingId] = useState("");
  const [assessments, setAssessments] = useState([]);
  const [assessmentView, setAssessmentView] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedOfferingId, setLoadedOfferingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [staleAssessment, setStaleAssessment] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [correctionHistory, setCorrectionHistory] = useState([]);
  const [historyPagination, setHistoryPagination] = useState({ currentPage: 1, totalPages: 0, totalRecords: 0 });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const assessmentRequestSequence = useRef(0);
  const historyRequestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    if (!offeringId) return () => { active = false; };
    getAssessments(offeringId, getSessionMarker())
      .then((data) => { if (active) setAssessments(data.assessments || []); })
      .catch((error) => { if (active) setNotice({ type: "error", text: error.message }); })
      .finally(() => { if (active) setLoadedOfferingId(offeringId); });
    return () => {
      active = false;
      assessmentRequestSequence.current += 1;
      historyRequestSequence.current += 1;
    };
  }, [offeringId]);

  const applyView = (view) => {
    setAssessmentView({
      ...view,
      roster: (view.roster || []).map(({ student, result }) => ({
        student,
        score: result ? String(result.score) : "",
        feedback: result?.feedback || "",
        savedScore: result ? String(result.score) : "",
        savedFeedback: result?.feedback || "",
      })),
    });
  };

  const selectAssessment = async (id) => {
    const requestSequence = ++assessmentRequestSequence.current;
    historyRequestSequence.current += 1;
    if (!id) {
      setAssessmentView(null);
      setHistoryVisible(false);
      setCorrectionHistory([]);
      setHistoryLoading(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setAssessmentView(null);
    setStaleAssessment(false);
    setHistoryVisible(false);
    setCorrectionHistory([]);
    setHistoryError("");
    setHistoryLoading(false);
    setNotice({ type: "", text: "" });
    try {
      const view = await getAssessment(id, getSessionMarker());
      if (requestSequence !== assessmentRequestSequence.current) return;
      applyView(view);
    } catch (error) {
      if (requestSequence === assessmentRequestSequence.current) setNotice({ type: "error", text: error.message });
    } finally {
      if (requestSequence === assessmentRequestSequence.current) setLoading(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!offeringId) return;
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const payload = {
        offeringId,
        title: form.title,
        type: form.type,
        maxScore: Number(form.maxScore),
        ...(form.weight !== "" ? { weight: Number(form.weight) } : {}),
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      };
      const { assessment } = await createAssessment(payload, getSessionMarker());
      setAssessments((current) => [assessment, ...current]);
      setForm(emptyForm);
      await selectAssessment(assessment._id);
      setNotice({ type: "success", text: "Assessment created as a draft." });
      await onSummaryRefresh?.();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const gradesFromRoster = (roster) => roster
    .filter((row) => row.score !== "")
    .map((row) => ({ studentId: row.student._id, score: Number(row.score), feedback: row.feedback }));

  const loadCorrectionHistory = async (assessmentId = assessmentView?.assessment?._id, requestedPage = 1) => {
    if (!assessmentId) return;
    const requestSequence = ++historyRequestSequence.current;
    setHistoryLoading(true);
    setHistoryError("");
    setCorrectionHistory([]);
    setHistoryPagination({ currentPage: requestedPage, totalPages: 0, totalRecords: 0 });
    try {
      const result = await getAssessmentHistory(assessmentId, requestedPage, getSessionMarker());
      if (requestSequence !== historyRequestSequence.current) return;
      setCorrectionHistory(result.changes || []);
      setHistoryPagination(result.pagination || { currentPage: 1, totalPages: 0, totalRecords: 0 });
    } catch (error) {
      if (requestSequence === historyRequestSequence.current) setHistoryError(error.message || "Unable to load correction history.");
    } finally {
      if (requestSequence === historyRequestSequence.current) setHistoryLoading(false);
    }
  };

  const handleSaveGrades = async () => {
    if (!assessmentView) return;
    const grades = gradesFromRoster(assessmentView.roster);
    if (!grades.length) { setNotice({ type: "error", text: "Enter at least one score before saving." }); return; }
    setSaving(true);
    try {
      const result = await saveDraftGrades(assessmentView.assessment._id, grades, assessmentView.assessment.revision, getSessionMarker());
      applyView(result);
      setNotice({ type: "success", text: "Grade draft saved." });
    } catch (error) {
      setStaleAssessment(error.status === 409 && error.message.includes("changed since you opened it"));
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!assessmentView || assessmentView.roster.some((row) => row.score === "")) {
      setNotice({ type: "error", text: "Enter a score for every active student before publishing." });
      return;
    }
    setSaving(true);
    try {
      const token = getSessionMarker();
      const draft = await saveDraftGrades(assessmentView.assessment._id, gradesFromRoster(assessmentView.roster), assessmentView.assessment.revision, token);
      applyView(draft);
      const result = await publishAssessment(assessmentView.assessment._id, draft.assessment.revision, token);
      applyView(result);
      setConfirmPublish(false);
      setAssessments((current) => current.map((item) => item._id === result.assessment._id ? result.assessment : item));
      setNotice({ type: "success", text: "Results published to students." });
      await onSummaryRefresh?.();
    } catch (error) {
      setStaleAssessment(error.status === 409 && error.message.includes("changed since you opened it"));
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCorrection = async () => {
    const correctionReason = reason.trim();
    if (!correctionReason) { setNotice({ type: "error", text: "Enter a reason for the grade correction." }); return; }
    const changedRows = assessmentView.roster.filter((row) => row.score !== row.savedScore || row.feedback !== row.savedFeedback);
    if (!changedRows.length) { setNotice({ type: "error", text: "Change a score or feedback before submitting a correction." }); return; }
    if (changedRows.some((row) => row.score === "")) { setNotice({ type: "error", text: "A published score cannot be left empty." }); return; }
    setSaving(true);
    try {
      const grades = changedRows.map((row) => ({ studentId: row.student._id, score: Number(row.score), feedback: row.feedback }));
      const result = await correctPublishedGrades(assessmentView.assessment._id, correctionReason, grades, assessmentView.assessment.revision, getSessionMarker());
      applyView(result);
      setReason("");
      setNotice({ type: "success", text: "Published grades corrected and audit history recorded." });
      if (historyVisible) await loadCorrectionHistory(assessmentView.assessment._id, 1);
      await onSummaryRefresh?.();
    } catch (error) {
      setStaleAssessment(error.status === 409 && error.message.includes("changed since you opened it"));
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="academic-card assessment-admin-card" aria-labelledby="assessment-admin-heading">
      <div className="academic-table-heading">
        <div><h3 id="assessment-admin-heading">Assessments & results</h3><p>Save draft grades, then publish them for student access.</p></div>
      </div>
      {notice.text && <div className={`academic-notice ${notice.type}`} role="status">{notice.text}</div>}
      {staleAssessment && assessmentView && <button type="button" className="secondary-button" disabled={loading || saving} onClick={() => selectAssessment(assessmentView.assessment._id)}>Reload latest assessment version</button>}
      <div className="assessment-select-row">
        <label>Course offering<select value={offeringId} onChange={(event) => {
          setOfferingId(event.target.value);
          setAssessments([]);
          setAssessmentView(null);
          setHistoryVisible(false);
          setCorrectionHistory([]);
          setHistoryError("");
          setHistoryLoading(false);
          setLoading(false);
          setNotice({ type: "", text: "" });
        }}>
          <option value="">Choose a course</option>
          {offerings.map((item) => <option key={item._id} value={item._id}>{item.courseCode} · {item.courseName} · {item.term} / {item.section}</option>)}
        </select></label>
        <label>Assessment<select disabled={!offeringId} value={assessmentView?.assessment?._id || ""} onChange={(event) => selectAssessment(event.target.value)}>
          <option value="">Choose an assessment</option>
          {assessments.map((item) => <option key={item._id} value={item._id}>{item.title} · {item.status}</option>)}
        </select></label>
      </div>
      {offeringId && <form className="assessment-create-form" onSubmit={handleCreate}>
        <h4>Create an assessment</h4>
        <div className="academic-fields">
          <label>Title<input required maxLength="120" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Midterm exam" /></label>
          <label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="assignment">Assignment</option><option value="quiz">Quiz</option><option value="midterm">Midterm</option><option value="final">Final</option><option value="project">Project</option><option value="other">Other</option></select></label>
          <label>Maximum score<input required type="number" min="0.01" max="100000" step="0.01" value={form.maxScore} onChange={(event) => setForm({ ...form, maxScore: event.target.value })} /></label>
          <label>Due date<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
        </div>
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Create draft assessment"}</button>
      </form>}
      {(loading || (Boolean(offeringId) && loadedOfferingId !== offeringId)) && <p className="academic-hint">Loading assessment…</p>}
      {assessmentView && <>
        <div className="assessment-view-heading">
          <div><h4>{assessmentView.assessment.title}</h4><p>{assessmentView.offering?.courseCode} · {assessmentView.assessment.type} · Max {assessmentView.assessment.maxScore}</p></div>
          <span className={`attendance-state ${assessmentView.assessment.status === "published" ? "finalized" : "draft"}`}>{assessmentView.assessment.status}</span>
        </div>
        {!assessmentView.roster.length ? <p className="academic-hint">Enroll students in this course before entering grades.</p> : <div className="academic-table-scroll">
          <table className="academic-table assessment-grade-table"><thead><tr><th>Student</th><th>Score / {assessmentView.assessment.maxScore}</th><th>Feedback</th></tr></thead>
            <tbody>{assessmentView.roster.map((row) => <tr key={row.student._id}>
              <td><strong>{row.student.name}</strong><small>{row.student.email}</small></td>
              <td><input aria-label={`Score for ${row.student.name}`} type="number" min="0" max={assessmentView.assessment.maxScore} step="0.01" value={row.score} disabled={saving} onChange={(event) => setAssessmentView((view) => ({ ...view, roster: view.roster.map((entry) => entry.student._id === row.student._id ? { ...entry, score: event.target.value } : entry) }))} /></td>
              <td><input aria-label={`Feedback for ${row.student.name}`} maxLength="500" value={row.feedback} disabled={saving} onChange={(event) => setAssessmentView((view) => ({ ...view, roster: view.roster.map((entry) => entry.student._id === row.student._id ? { ...entry, feedback: event.target.value } : entry) }))} placeholder="Optional feedback" /></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {assessmentView.assessment.status === "draft" && <div className="attendance-actions">
          <button className="secondary-button" type="button" disabled={saving || !assessmentView.roster.length} onClick={handleSaveGrades}>Save grade draft</button>
          <button className="primary-button" type="button" disabled={saving || !assessmentView.roster.length} onClick={() => setConfirmPublish(true)}>Publish results</button>
        </div>}
        {assessmentView.assessment.status === "published" && <div className="assessment-correction">
          <label>Correction reason<textarea maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this published grade needs correction" /></label>
          <button className="secondary-button" type="button" disabled={saving || !assessmentView.roster.length} onClick={handleCorrection}>Save audited correction</button>
          <button className="secondary-button" type="button" aria-expanded={historyVisible} onClick={() => {
            const next = !historyVisible;
            setHistoryVisible(next);
            if (next) loadCorrectionHistory(assessmentView.assessment._id, 1);
            else {
              historyRequestSequence.current += 1;
              setHistoryLoading(false);
            }
          }}>{historyVisible ? "Hide correction history" : "View correction history"}</button>
        </div>}
        {historyVisible && assessmentView.assessment.status === "published" && <section className="assessment-history" aria-label="Published grade correction history" aria-busy={historyLoading}>
          <h4>Correction history</h4>
          {historyError && <p className="academic-notice error" role="alert">{historyError}</p>}
          {historyLoading ? <p className="academic-hint" role="status" aria-live="polite">Loading correction history…</p> : !correctionHistory.length && !historyError ? <p className="academic-hint" role="status">No published grade corrections have been recorded.</p> : correctionHistory.length > 0 && <div className="academic-table-scroll" role="region" aria-label="Correction history table" tabIndex={0}>
            <table className="academic-table"><caption className="sr-only">Published assessment grade corrections</caption><thead><tr><th scope="col">Changed</th><th scope="col">Student</th><th scope="col">Score change</th><th scope="col">Feedback change</th><th scope="col">Reason</th><th scope="col">Changed by</th></tr></thead>
              <tbody>{correctionHistory.map((change, index) => <tr key={`${change.changedAt}-${index}`}>
                <td>{change.changedAt ? new Date(change.changedAt).toLocaleString() : "—"}</td>
                <td><strong>{change.student?.name || "Student record"}</strong><small>{change.student?.email || "Record unavailable"}</small></td>
                <td>{change.previousScore} → {change.newScore}</td>
                <td><small>Before: {change.previousFeedback || "—"}</small><small>After: {change.newFeedback || "—"}</small></td>
                <td>{change.reason}</td><td>{change.changedBy}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          {historyPagination.totalPages > 1 && <div className="enrollment-pagination"><button type="button" className="secondary-button" aria-label="Previous correction history page" disabled={historyLoading || historyPagination.currentPage <= 1} onClick={() => loadCorrectionHistory(assessmentView.assessment._id, historyPagination.currentPage - 1)}>Previous</button><span aria-live="polite">Page {historyPagination.currentPage} of {historyPagination.totalPages} · {historyPagination.totalRecords} changes</span><button type="button" className="secondary-button" aria-label="Next correction history page" disabled={historyLoading || historyPagination.currentPage >= historyPagination.totalPages} onClick={() => loadCorrectionHistory(assessmentView.assessment._id, historyPagination.currentPage + 1)}>Next</button></div>}
        </section>}
      </>}
      {confirmPublish && <ConfirmDialog
        title="Publish these results?"
        message="All active students in this course will be able to see their scores. Later changes will be recorded as audited corrections."
        confirmLabel="Publish results"
        busy={saving}
        onCancel={() => setConfirmPublish(false)}
        onConfirm={handlePublish}
      />}
    </section>
  );
}

export default AssessmentManagement;
