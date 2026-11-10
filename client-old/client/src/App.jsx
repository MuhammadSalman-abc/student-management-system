import { useEffect, useState } from "react";
import AdminDashboard from "./components/AdminDashboard";
import StudentDashboard from "./components/StudentDashboard";
import InvitationAcceptance from "./components/InvitationAcceptance";
import PasswordResetAcceptance from "./components/PasswordResetAcceptance";
import logo from "./assets/student management logo.png";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
} from "./api";
import { getSessionMarker, setSessionActive } from "./sessionState";

const clearLegacyCredentials = () => {
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  } catch {
    // Legacy browser storage is optional; the HttpOnly cookie is authoritative.
  }
};

// =========================
// LOGIN
// =========================

function Login({ onLogin, onRegister, initialNotice }) {
  const [loginMode, setLoginMode] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState("");
  const visibleNotice = errorNotice || initialNotice;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      setErrorNotice("Enter your email address and password to continue.");
      return;
    }

    try {
      setLoading(true);
      setErrorNotice("");

      const data = await loginUser({
        email: email.trim(),
        password,
      });

      if (!data?.user) {
        throw new Error("Invalid login response from server.");
      }

      if (data.user.role !== loginMode) {
        await logoutUser().catch(() => {});
        throw new Error(loginMode === "admin"
          ? "This is a student account. Choose Student login to continue."
          : "This is an administrator account. Choose Admin login to continue.");
      }

      onLogin(data.user);

    } catch (error) {
      setErrorNotice(error.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">

      {/* LEFT SIDE */}
      <div className="auth-left">

        <div className="auth-brand">

          <div className="logo-icon">
            <img
              src={logo}
              alt="StudentHub Logo"
            />
          </div>

          <div>
            <h2>StudentHub</h2>
            <span>Management System</span>
          </div>

        </div>

        <div className="auth-intro">

          <h1>
            STUDENT MANAGEMENT SYSTEM
          </h1>

          <p>
            A simple and powerful student
            management system to track
            attendance, assignments and
            academic performance.
          </p>

          <div className="feature-list">

            <div>
              ✓ Student Performance Tracking
            </div>

            <div>
              ✓ Attendance Management
            </div>

            <div>
              ✓ Academic Reports
            </div>

          </div>

        </div>

      </div>


      {/* RIGHT SIDE */}
      <div className="auth-right">

        <form
          className="auth-card auth-login-card"
          onSubmit={handleSubmit}
        >

          <div className="auth-title">

            <h1>
              {loginMode === "admin" ? "Admin sign in" : "Student sign in"}
            </h1>

            <p>
              {loginMode === "admin" ? "Access your StudentHub workspace." : "View your classes and academic progress."}
            </p>

          </div>

          <div className="login-mode-switch" role="group" aria-label="Choose sign-in type">
            <button type="button" disabled={loading} className={loginMode === "admin" ? "selected" : ""} aria-pressed={loginMode === "admin"} onClick={() => { setLoginMode("admin"); setErrorNotice(""); }}>
              <span className="login-mode-icon" aria-hidden="true">A</span><span><strong>Admin Login</strong><small>Manage your school</small></span>
            </button>
            <button type="button" disabled={loading} className={loginMode === "student" ? "selected" : ""} aria-pressed={loginMode === "student"} onClick={() => { setLoginMode("student"); setErrorNotice(""); }}>
              <span className="login-mode-icon student" aria-hidden="true">S</span><span><strong>Student Login</strong><small>View your learning</small></span>
            </button>
          </div>

          {visibleNotice && <p className="auth-session-notice" role={errorNotice ? "alert" : "status"}>{visibleNotice}</p>}


          {/* EMAIL */}
          <label>

            {loginMode === "admin" ? "Administrator email" : "Student email"}

            <input
              type="email"
              autoComplete="username"
              required
              placeholder={loginMode === "admin" ? "admin@school.edu" : "student@school.edu"}
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
            />

          </label>


          {/* PASSWORD */}
          <label>

            Password

            <input
              type="password"
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
            />

          </label>


          {/* LOGIN BUTTON */}
          <button
            className="login-button"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : loginMode === "admin" ? "Sign in as admin" : "Sign in as student"}
          </button>

          {loginMode === "student" ? <>
            <p className="login-help-text">Student accounts are activated using a secure link from your administrator.</p>
            <p className="register-text">Have an invitation? <button type="button" onClick={onRegister}>Activate account</button></p>
            <p className="login-help-text">Forgot your password? Contact your administrator to verify your identity and issue a reset link.</p>
          </> : <p className="login-help-text">Administrator access is limited to authorized school staff. Contact your system owner if you need account help.</p>}

        </form>

      </div>

    </div>
  );
}


// =========================
// REGISTER
// =========================

function App() {
  const initialHash = new URLSearchParams(window.location.hash.slice(1));
  const [hasInitialActionToken] = useState(() => initialHash.has("invite") || initialHash.has("reset"));
  const [invitationToken, setInvitationToken] = useState(() => initialHash.get("invite") || "");
  const [passwordResetToken, setPasswordResetToken] = useState(() => initialHash.has("invite") ? "" : initialHash.get("reset") || "");
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(() => !initialHash.has("invite") && !initialHash.has("reset"));
  const [sessionNotice, setSessionNotice] = useState("");

  useEffect(() => {
    const handleSessionExpired = () => {
      const hasAuthenticatedSession = (() => {
        try {
          return getSessionMarker() === "yes";
        } catch {
          return false;
        }
      })();
      if (!hasAuthenticatedSession) return;

      setSessionActive(false);
      clearLegacyCredentials();
      setUser(null);
      setScreen("login");
      setSessionNotice("Your session expired or was revoked. Sign in again to continue.");
      logoutUser().catch(() => {});
    };
    window.addEventListener("studenthub:session-expired", handleSessionExpired);
    return () => window.removeEventListener("studenthub:session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    if (hasInitialActionToken) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return undefined;
    }
    let current = true;
    getCurrentUser()
      .then((verifiedUser) => {
        if (!current) return;
        clearLegacyCredentials();
        setSessionActive(true);
        setUser(verifiedUser);
        setScreen(verifiedUser.role === "admin" ? "admin" : "student");
      })
      .catch((error) => {
        if (!current) return;
        // A 401 simply means no saved session. Other failures indicate the API
        // could not verify the session and should be visible on the sign-in page.
        if (error.status !== 401) setSessionNotice(error.message || "Unable to verify your session. Please try again.");
        setSessionActive(false);
        // Remove credentials created by the previous localStorage-based client.
        clearLegacyCredentials();
      })
      .finally(() => {
        if (current) setCheckingSession(false);
      });

    return () => { current = false; };
  }, [hasInitialActionToken]);


  // =========================
  // LOGIN SUCCESS
  // =========================

  const handleLogin = (loggedInUser) => {

    setSessionNotice("");
    setSessionActive(true);
    setUser(loggedInUser);

    if (
      loggedInUser?.role === "admin"
    ) {

      setScreen("admin");

    } else {

      setScreen("student");

    }

  };

  if (invitationToken) {
    return <InvitationAcceptance
      token={invitationToken}
      onActivated={(activatedUser) => {
        setInvitationToken("");
        handleLogin(activatedUser);
      }}
      onBack={() => setInvitationToken("")}
    />;
  }

  if (passwordResetToken) {
    return <PasswordResetAcceptance
      token={passwordResetToken}
      onCompleted={(message) => {
        setPasswordResetToken("");
        setScreen("login");
        setSessionNotice(message);
      }}
      onBack={() => setPasswordResetToken("")}
    />;
  }

  if (checkingSession) {
    return <main className="auth-page" aria-live="polite"><div className="auth-card"><p>Checking your session…</p></div></main>;
  }

  if (screen === "register") {
    return <InvitationAcceptance
      token=""
      onActivated={handleLogin}
      onBack={() => setScreen("login")}
    />;
  }


  // =========================
  // LOGOUT
  // =========================

  const handleLogout = async () => {
    await logoutUser().catch(() => {});
    setSessionActive(false);
    clearLegacyCredentials();

    setUser(null);
    setScreen("login");

  };


  // =========================
  // STUDENT
  // =========================

  if (
    screen === "student" &&
    user
  ) {

    return (
      <StudentDashboard
        onLogout={handleLogout}
        user={user}
      />
    );

  }


  // =========================
  // ADMIN
  // =========================

  if (
    screen === "admin" &&
    user
  ) {

    return (
      <AdminDashboard
        onLogout={handleLogout}
      />
    );

  }


  // =========================
  // LOGIN
  // =========================

  return (
    <Login
      onLogin={handleLogin}
      onRegister={() => setScreen("register")}
      initialNotice={sessionNotice}
    />
  );
}

export default App;
