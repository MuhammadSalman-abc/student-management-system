import { useEffect, useState } from "react";
import { getSessionMarker } from "../sessionState";
import { getMyResults } from "../api";

function StudentResults() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadedPage, setLoadedPage] = useState(0);
  const [errorState, setErrorState] = useState(null);
  const loading = loadedPage !== page;
  const error = errorState?.page === page ? errorState.message : "";

  useEffect(() => {
    let active = true;
    getMyResults(getSessionMarker(), page)
      .then((result) => { if (active) { setData(result); setErrorState(null); } })
      .catch((requestError) => { if (active) setErrorState({ page, message: requestError.message }); })
      .finally(() => { if (active) setLoadedPage(page); });
    return () => { active = false; };
  }, [page]);

  const pagination = data?.pagination || { currentPage: 1, totalPages: 1 };

  return (
    <section className="student-results-card" aria-labelledby="student-results-heading">
      <h2 id="student-results-heading">Published results</h2>
      <p>Assessment scores appear here only after your school releases them.</p>
      {error && <div className="academic-notice error" role="alert">{error}</div>}
      {error ? null : loading ? <p className="academic-hint">Loading results…</p> : !data?.results?.length ? <p className="academic-hint">No published results yet.</p> : <>
        <div className="academic-table-scroll"><table className="student-attendance-table">
          <thead><tr><th>Assessment</th><th>Course</th><th>Score</th><th>Released</th><th>Feedback</th></tr></thead>
          <tbody>{data.results.map((item, index) => <tr key={`${item.assessment?.title}-${item.gradedAt}-${index}`}>
            <td><strong>{item.assessment?.title}</strong><small>{item.assessment?.type}</small></td>
            <td>{item.course?.courseCode} · {item.course?.courseName}<small>{item.course?.term} / {item.course?.section}</small></td>
            <td><span className="result-score">{item.score} / {item.assessment?.maxScore}</span></td>
            <td>{item.assessment?.publishedAt ? new Date(item.assessment.publishedAt).toLocaleDateString() : "—"}</td>
            <td className="result-feedback">{item.feedback || "—"}</td>
          </tr>)}</tbody>
        </table></div>
        {pagination.totalPages > 1 && <div className="attendance-pagination">
          <button type="button" className="pagination-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>Page {pagination.currentPage} of {pagination.totalPages}</span>
          <button type="button" className="pagination-button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>}
      </>}
    </section>
  );
}

export default StudentResults;
