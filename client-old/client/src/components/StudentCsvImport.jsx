import { useRef, useState } from "react";
import { getSessionMarker } from "../sessionState";
import { importStudents } from "../api";

const REQUIRED_COLUMNS = ["name", "email"];
const OPTIONAL_COLUMNS = ["studentnumber", "course", "batch", "attendance", "assignmentscore", "finalscore"];

const parseCsv = (input) => {
  const text = input.replace(/^\uFEFF/, "");
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
        afterQuote = true;
      } else if (!field && !afterQuote) {
        quoted = true;
      } else {
        throw new Error("CSV contains a quote in an invalid position.");
      }
    } else if (!quoted && character === ",") {
      record.push(field);
      field = "";
      afterQuote = false;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      record.push(field);
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
      afterQuote = false;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      if (afterQuote) {
        if (/\s/.test(character)) continue;
        throw new Error("CSV contains data after a closing quote.");
      }
      field += character;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (field || record.length) {
    record.push(field);
    if (record.some((value) => value.trim())) records.push(record);
  }
  if (records.length < 2) throw new Error("CSV must contain a header and at least one student row.");

  const headers = records[0].map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains a repeated column name.");
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  const extra = headers.filter((column) => !REQUIRED_COLUMNS.includes(column) && !OPTIONAL_COLUMNS.includes(column));
  if (missing.length || extra.length) {
    const detail = [missing.length ? `Missing: ${missing.join(", ")}` : "", extra.length ? `Unsupported: ${extra.join(", ")}` : ""].filter(Boolean).join(". ");
    throw new Error(`Use the supplied CSV template. ${detail}.`);
  }
  if (records.length - 1 > 100) throw new Error("Import files are limited to 100 students per batch.");

  const positions = Object.fromEntries(headers.map((header, index) => [header, index]));
  return records.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
    return {
      name: values[positions.name].trim(),
      email: values[positions.email].trim(),
      ...(positions.studentnumber !== undefined ? { studentNumber: values[positions.studentnumber].trim() } : {}),
      ...(positions.course !== undefined && values[positions.course].trim() ? { course: values[positions.course].trim() } : {}),
      ...(positions.batch !== undefined && values[positions.batch].trim() ? { batch: values[positions.batch].trim() } : {}),
      ...(positions.attendance !== undefined && values[positions.attendance].trim() ? { attendance: values[positions.attendance].trim() } : {}),
      ...(positions.assignmentscore !== undefined && values[positions.assignmentscore].trim() ? { assignmentScore: values[positions.assignmentscore].trim() } : {}),
      ...(positions.finalscore !== undefined && values[positions.finalscore].trim() ? { finalScore: values[positions.finalscore].trim() } : {}),
    };
  });
};

const downloadTemplate = () => {
  const csv = "studentNumber,name,email,course,batch,attendance,assignmentScore,finalScore\r\n";
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "studenthub-student-import-template.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function StudentCsvImport({ onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [rowErrors, setRowErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    setRows([]);
    setFileName("");
    setRowErrors([]);
    setNotice({ type: "", text: "" });
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 256 * 1024) {
      setNotice({ type: "error", text: "Choose a CSV file smaller than 256 KB." });
      event.target.value = "";
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      setFileName(file.name);
      setRows(parsed);
      setNotice({ type: "success", text: `${parsed.length} student rows ready for review.` });
    } catch (error) {
      setFileName("");
      setNotice({ type: "error", text: error.message });
      event.target.value = "";
    }
  };

  const handleImport = async () => {
    let importedCount = null;
    setBusy(true);
    setNotice({ type: "", text: "" });
    setRowErrors([]);
    try {
      const result = await importStudents(rows, getSessionMarker());
      importedCount = result.importedCount;
      setRows([]);
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      setNotice({ type: "success", text: result.message });
    } catch (error) {
      setNotice({ type: "error", text: error.message || "Unable to import student records." });
      setRowErrors(error.details || []);
    } finally {
      setBusy(false);
    }
    if (importedCount !== null) {
      try {
        await onImported?.(importedCount);
      } catch {
        setNotice({ type: "success", text: "Import completed. Reload the roster to see the new records." });
      }
    }
  };

  return <section className="student-import-card" aria-labelledby="student-import-title">
    <div className="student-import-heading">
      <div><h3 id="student-import-title">Import student roster</h3><p>Preview a CSV, then import up to 100 student records as one all-or-nothing batch. Legacy course, batch, attendance, and score columns are optional.</p></div>
      <button type="button" className="academic-link-button" onClick={downloadTemplate}>Download CSV template</button>
    </div>
    <div className="student-import-controls">
      <label htmlFor="student-csv-file">Choose CSV file</label>
      <input ref={inputRef} id="student-csv-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={handleFile} />
      {fileName && <span>{fileName}</span>}
      {rows.length > 0 && <button type="button" className="cancel-button" disabled={busy} onClick={() => { setRows([]); setFileName(""); setNotice({ type: "", text: "" }); setRowErrors([]); if (inputRef.current) inputRef.current.value = ""; }}>Clear</button>}
      {rows.length > 0 && <button type="button" className="primary-button" disabled={busy} onClick={handleImport}>{busy ? "Importing…" : `Import ${rows.length} students`}</button>}
    </div>
    {notice.text && <p className={`report-feedback ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.text}</p>}
    {rowErrors.length > 0 && <ul className="student-import-errors">{rowErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
    {rows.length > 0 && <>
      <p className="academic-hint">Preview all {rows.length} records. Duplicate addresses or invalid values will reject the entire batch.</p>
      <div className="academic-table-scroll"><table className="academic-table student-import-preview"><thead><tr><th>Student number</th><th>Name</th><th>Email</th><th>Course</th><th>Batch</th><th>Attendance</th><th>Assignment</th><th>Final</th></tr></thead><tbody>
        {rows.map((row, index) => <tr key={`${row.email}-${index}`}><td>{row.studentNumber || "—"}</td><td>{row.name}</td><td>{row.email}</td><td>{row.course || "—"}</td><td>{row.batch || "—"}</td><td>{row.attendance ?? "—"}</td><td>{row.assignmentScore ?? "—"}</td><td>{row.finalScore ?? "—"}</td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}

export default StudentCsvImport;
