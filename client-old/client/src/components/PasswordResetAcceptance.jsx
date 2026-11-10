import { useEffect, useState } from "react";
import { completePasswordReset, inspectPasswordReset } from "../api";
import logo from "../assets/student management logo.png";

function PasswordResetAcceptance({ token, onCompleted, onBack }) {
  const [student, setStudent] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    inspectPasswordReset(token)
      .then((result) => { if (active) setStudent(result.student); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

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
      const result = await completePasswordReset(token, password);
      onCompleted(result.message);
    } catch (requestError) {
      setError(requestError.message || "Unable to reset this password.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="auth-page">
    <div className="auth-left">
      <div className="auth-brand"><div className="logo-icon"><img src={logo} alt="StudentHub Logo" /></div><div><h2>StudentHub</h2><span>Management System</span></div></div>
      <div className="auth-intro"><h1>Secure password reset</h1><p>Choose a new password for your student account. Previous sessions will be signed out.</p></div>
    </div>
    <div className="auth-right">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-title"><h1>Reset password</h1><p>Set a new password for your account.</p></div>
        {loading ? <p role="status">Checking reset link…</p> : student ? <>
          <div className="invited-student"><strong>{student.name}</strong><span>{student.email}</span></div>
          <label>New password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm new password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <p className="student-form-help">Use 12–128 characters. Reset links expire after 30 minutes and can be used once.</p>
          <button className="login-button" type="submit" disabled={submitting}>{submitting ? "Resetting password…" : "Set new password"}</button>
        </> : <p role="status">This reset link is unavailable. Contact your administrator to verify your identity and issue another link.</p>}
        {error && <p className="auth-session-notice" role="alert">{error}</p>}
        <button className="secondary-button" type="button" onClick={onBack}>Back to sign in</button>
      </form>
    </div>
  </div>;
}

export default PasswordResetAcceptance;
