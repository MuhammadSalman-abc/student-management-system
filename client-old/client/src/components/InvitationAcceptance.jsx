import { useEffect, useState } from "react";
import { acceptStudentInvitation, getStudentInvitation } from "../api";
import logo from "../assets/student management logo.png";

function InvitationAcceptance({ token, onActivated, onBack }) {
  const [student, setStudent] = useState(null);
  const [inviteInput, setInviteInput] = useState(token || "");
  const [verifiedToken, setVerifiedToken] = useState(token || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    getStudentInvitation(token)
      .then((result) => { if (active) { setStudent(result.student); setVerifiedToken(token); } })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const handleCheckInvitation = async (event) => {
    event.preventDefault();
    setError("");
    let candidate = inviteInput.trim();
    try {
      if (candidate.includes("#")) {
        candidate = new URL(candidate).hash.slice(1);
      }
      const parameters = new URLSearchParams(candidate.replace(/^#/, ""));
      candidate = parameters.get("invite") || candidate;
    } catch {
      setError("Enter a valid invitation link or code.");
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) {
      setError("Enter the invitation link or code sent by your administrator.");
      return;
    }
    setLoading(true);
    try {
      const result = await getStudentInvitation(candidate);
      setVerifiedToken(candidate);
      setStudent(result.student);
    } catch (requestError) {
      setError(requestError.message || "This invitation is invalid or expired.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 12 || password.length > 128) {
      setError("Choose a password between 12 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await acceptStudentInvitation(verifiedToken, password);
      if (!result.user) throw new Error("The activation response was incomplete.");
      onActivated(result.user);
    } catch (requestError) {
      setError(requestError.message || "Unable to activate this account.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="auth-page">
    <div className="auth-left">
      <div className="auth-brand"><div className="logo-icon"><img src={logo} alt="StudentHub Logo" /></div><div><h2>StudentHub</h2><span>Management System</span></div></div>
      <div className="auth-intro"><h1>Secure account activation</h1><p>Your administrator invited you to access your StudentHub academic records.</p></div>
    </div>
    <div className="auth-right">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-title"><h1>Activate account</h1><p>Create a password for your student account.</p></div>
        {loading ? <p role="status">Checking invitation…</p> : student ? <>
          <div className="invited-student"><strong>{student.name}</strong><span>{student.email}</span></div>
          <label>Password<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm password<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button className="login-button" type="submit" disabled={submitting}>{submitting ? "Activating…" : "Activate student account"}</button>
        </> : token ? <p role="status">This invitation is unavailable. Ask your administrator for a new link.</p> : <>
          <p>Student registration requires an invitation from your administrator.</p>
          <label>Invitation link or code<input required autoComplete="off" value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} placeholder="Paste your invitation link or code" /></label>
          <button className="login-button" type="button" disabled={loading || !inviteInput.trim()} onClick={handleCheckInvitation}>{loading ? "Checking…" : "Check invitation"}</button>
        </>}
        {error && <p className="auth-session-notice" role="alert">{error}</p>}
        <p className="register-text"><button type="button" onClick={onBack}>Back to sign in</button></p>
      </form>
    </div>
  </div>;
}

export default InvitationAcceptance;
