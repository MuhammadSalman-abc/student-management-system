import { useEffect, useState } from "react";
import { getSessionMarker } from "../sessionState";
import { getMyAttendance } from "../api";

function StudentAttendance({ onSummary }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadedPage, setLoadedPage] = useState(0);
  const [errorState, setErrorState] = useState(null);
  const loading = loadedPage !== page;
  const error = errorState?.page === page ? errorState.message : "";

  useEffect(() => {
    let active = true;
    getMyAttendance(getSessionMarker(), page)
      .then((result) => { if (active) { setData(result); setErrorState(null); onSummary?.(result.summary?.percentage ?? null); } })
      .catch((requestError) => { if (active) setErrorState({ page, message: requestError.message }); })
      .finally(() => { if (active) setLoadedPage(page); });
    return () => { active = false; };
  }, [page, onSummary]);

  const summary = data?.summary || {};
  const pagination = data?.pagination || { currentPage: 1, totalPages: 1 };

  return (
    <section className="student-attendance-card" aria-labelledby="student-attendance-heading">
      <div className="student-attendance-head">
        <div><h2 id="student-attendance-heading">Attendance history</h2><p>Only finalized class sessions appear here.</p></div>
        <strong className="student-attendance-rate">{summary.percentage == null ? "—" : `${summary.percentage}%`}</strong>
      </div>
      {error && <p className="academic-notice error" role="alert">{error}</p>}
      <div className="student-attendance-counts" aria-label="Attendance totals">
        <span>Present {summary.present || 0}</span><span>Late {summary.late || 0}</span><span>Absent {summary.absent || 0}</span><span>Excused {summary.excused || 0}</span>
      </div>
      {error ? null : loading ? <p className="academic-hint">Loading attendance…</p> : !data?.records?.length ? <p className="academic-hint">No finalized attendance records yet.</p> : <>
        <div className="academic-table-scroll"><table className="student-attendance-table">
          <thead><tr><th>Date</th><th>Course</th><th>Status</th></tr></thead>
          <tbody>{data.records.map((record, index) => <tr key={`${record.date}-${record.course?.courseCode}-${index}`}>
            <td>{new Date(`${record.date}T00:00:00`).toLocaleDateString()}</td>
            <td>{record.course?.courseCode} · {record.course?.courseName} <small>{record.course?.term} / {record.course?.section}</small></td>
            <td><span className={`attendance-mark ${record.status}`}>{record.status}</span></td>
          </tr>)}</tbody>
        </table></div>
        {pagination.totalPages > 1 && <div className="attendance-pagination">
          <button type="button" className="pagination-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>Page {pagination.currentPage} of {pagination.totalPages}</span>
          <button type="button" className="pagination-button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>}
      </>}
      <p className="student-attendance-note">Attendance rate counts Present and Late as attended; Excused sessions are excluded from the rate.</p>
    </section>
  );
}

export default StudentAttendance;
