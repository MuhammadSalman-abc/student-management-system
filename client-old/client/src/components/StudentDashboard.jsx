import {
  useEffect,
  useState,
} from "react";
import { getSessionMarker } from "../sessionState";

import {
  changePassword,
  deleteMyProfilePhoto,
  getMyProfilePhoto,
  getMyStudentProfile,
  updateMyProfile,
  updateMyProfilePhoto,
} from "../api";
import logo from "../assets/student management logo.png";
import StudentAttendance from "./StudentAttendance";
import StudentResults from "./StudentResults";

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("This photo could not be processed."));
  reader.readAsDataURL(blob);
});

const readLegacyPhoto = (key) => {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
};

const removeLegacyPhoto = (key) => {
  try { localStorage.removeItem(key); } catch { /* Account photo remains authoritative. */ }
};

function StudentDashboard({ onLogout, user }) {
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // Profile popup
  const [showProfile, setShowProfile] = useState(false);

  // Profile picture
  const [profilePicture, setProfilePicture] = useState("");
  const [pictureSaving, setPictureSaving] = useState(false);
  const [officialAttendance, setOfficialAttendance] = useState(null);
  const [displayName, setDisplayName] = useState(user?.displayName || user?.name || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  const [pictureError, setPictureError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // =========================
  // LOAD STUDENT
  // =========================

  useEffect(() => {
    const loadStudent = async () => {
      try {
        const token =
          getSessionMarker();

        if (!token) {
          setError("Please login again.");
          return;
        }

        const data =
          await getMyStudentProfile(token);

        setStudent(data);

        const photoKey = `studentProfilePicture_${data._id || data.email}`;
        const legacyBrowserPhoto = readLegacyPhoto(photoKey);
        try {
          const accountPhoto = await getMyProfilePhoto();
          if (accountPhoto) {
            setProfilePicture(await blobToDataUrl(accountPhoto));
            removeLegacyPhoto(photoKey);
          } else if (legacyBrowserPhoto) {
            setProfilePicture(legacyBrowserPhoto);
          }
        } catch {
          // Existing browser-only photos remain available if the account photo
          // endpoint is temporarily unavailable.
          if (legacyBrowserPhoto) setProfilePicture(legacyBrowserPhoto);
        }

      } catch (err) {
        console.error(
          "Student profile error:",
          err
        );

        setError(
          err.message ||
            "Unable to load student profile."
        );
      } finally {
        setLoading(false);
      }
    };

    loadStudent();
  }, []);


  // =========================
  // PROFILE PICTURE UPLOAD
  // =========================

  const handleProfilePicture = (e) => {
    const file =
      e.target.files?.[0];
    const input = e.currentTarget;

    if (!file || !student || pictureSaving) {
      return;
    }
    const photoKey = `studentProfilePicture_${student._id || student.email}`;
    const fail = (message) => {
      setPictureError(message);
      setPictureSaving(false);
      input.value = "";
    };
    setPictureSaving(true);
    setPictureError("");

    // Only image files
    if (!file.type.startsWith("image/")) {
      fail("Choose an image file to update your profile picture.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      fail("Choose an image smaller than 5 MB.");
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 25_000_000) {
        fail("Choose an image with dimensions under 25 megapixels.");
        return;
      }
      const maxEdge = 512;
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        fail("This browser could not process the selected image.");
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) {
          fail("This image could not be processed. Try another file.");
          return;
        }
        try {
          if (blob.size > 400 * 1024) {
            fail("The resized photo is larger than 400 KB. Choose a simpler image and try again.");
            return;
          }
          const imageData = await blobToDataUrl(blob);
          await updateMyProfilePhoto(blob);
          removeLegacyPhoto(photoKey);
          setProfilePicture(imageData);
          setPictureError("");
          setPictureSaving(false);
          input.value = "";
        } catch (uploadError) {
          fail(uploadError.message || "Unable to save your profile photo.");
        }
      }, "image/jpeg", 0.82);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      input.value = "";
      fail("This image could not be opened. Try another image file.");
    };
    image.src = imageUrl;
  };

  const handleRemoveProfilePicture = async () => {
    if (pictureSaving || !student) return;
    setPictureSaving(true);
    setPictureError("");
    try {
      await deleteMyProfilePhoto();
      removeLegacyPhoto(`studentProfilePicture_${student._id || student.email}`);
      setProfilePicture("");
    } catch (removeError) {
      setPictureError(removeError.message || "Unable to remove your profile photo.");
    } finally {
      setPictureSaving(false);
    }
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileNotice("");
    setProfileError("");
    try {
      const result = await updateMyProfile(displayName);
      setDisplayName(result.user.displayName);
      setProfileNotice("Preferred name updated.");
    } catch (requestError) {
      setProfileError(requestError.message || "Unable to update your profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    setProfileNotice("");
    setProfileError("");
    if (newPassword !== confirmNewPassword) {
      setProfileError("The new passwords do not match.");
      return;
    }
    setProfileSaving(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setProfileNotice(result.message);
    } catch (requestError) {
      setProfileError(requestError.message || "Unable to change your password.");
    } finally {
      setProfileSaving(false);
    }
  };


  // =========================
  // LOADING
  // =========================

  if (loading) {
    return (
      <div className="simple-dashboard">

        <header className="simple-header">

          <div className="auth-brand">

            <div className="logo-icon">

              <img
                src={logo}
                alt="StudentHub Logo"
              />

            </div>

            <div>

              <h2>
                StudentHub
              </h2>

              <span>
                Student Portal
              </span>

            </div>

          </div>


          <button
            className="logout-button"
            onClick={onLogout}
          >
            Logout
          </button>

        </header>


        <main className="student-home">

          <div className="empty-state">

            <h2>
              Loading your dashboard...
            </h2>

            <p>
              Please wait...
            </p>

          </div>

        </main>

      </div>
    );
  }


  // =========================
  // ERROR
  // =========================

  if (error || !student) {
    return (
      <div className="simple-dashboard">

        <header className="simple-header">

          <div className="auth-brand">

            <div className="logo-icon">

              <img
                src={logo}
                alt="StudentHub Logo"
              />

            </div>

            <div>

              <h2>
                StudentHub
              </h2>

              <span>
                Student Portal
              </span>

            </div>

          </div>


          <button
            className="logout-button"
            onClick={onLogout}
          >
            Logout
          </button>

        </header>


        <main className="student-home">

          <div className="empty-state">

            <h2>
              Student Dashboard
            </h2>

            <p>
              {error ||
                "Student record not found."}
            </p>

          </div>

        </main>

      </div>
    );
  }


  // =========================
  // VALUES
  // =========================

  const attendance =
    officialAttendance ?? (Number(student.attendance) || 0);

  const assignment =
    Number(student.assignmentScore) || 0;

  const finalScore =
    Number(student.finalScore) || 0;


  const overallPerformance = (
    attendance * 0.2 +
    assignment * 0.3 +
    finalScore * 0.5
  ).toFixed(1);


  // =========================
  // STATUS
  // =========================

  const getStatus = () => {
    if (
      Number(overallPerformance) >= 85
    ) {
      return "Excellent";
    }

    if (
      Number(overallPerformance) >= 70
    ) {
      return "Good";
    }

    if (
      Number(overallPerformance) >= 50
    ) {
      return "Average";
    }

    return "Needs Improvement";
  };


  const firstLetter =
    (displayName || student.name)
      ?.charAt(0)
      ?.toUpperCase() || "S";
  const preferredName = displayName.trim() || user?.name || student.name;


  // =========================
  // RENDER
  // =========================

  return (
    <div className="simple-dashboard">

      {/* =========================
          HEADER
      ========================= */}

      <header className="simple-header">

        <div className="auth-brand">

          <div className="logo-icon">

            <img
              src={logo}
              alt="StudentHub Logo"
            />

          </div>


          <div>

            <h2>
              StudentHub
            </h2>

            <span>
              Student Portal
            </span>

          </div>

        </div>


        {/* =========================
            PROFILE + LOGOUT
        ========================= */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "18px",
            flexShrink: 0,
          }}
        >

          {/* PROFILE AVATAR */}

          <button
            type="button"
            className="profile-avatar-button"
            onClick={() =>
              setShowProfile(true)
            }
            title="Open Profile"
          >

            {profilePicture ? (

              <img
                src={profilePicture}
                alt="Student Profile"
                className="profile-avatar-image"
              />

            ) : (

              firstLetter

            )}

          </button>


          {/* LOGOUT */}

          <button
            type="button"
            className="logout-button"
            onClick={onLogout}
          >
            Logout
          </button>

        </div>

      </header>


      {/* =========================
          MAIN
      ========================= */}

      <main className="student-home">


        {/* WELCOME */}

        <section className="student-welcome">

          <div>

            <span className="small-label">
              STUDENT DASHBOARD
            </span>

            <h1>
              Welcome back, {preferredName}! 👋
            </h1>

            <p>
              Review finalized attendance, your legacy profile snapshot, and released assessment results.
            </p>

          </div>


          {/* SECONDARY AVATAR */}

          <div className="big-avatar">

            {profilePicture ? (

              <img
                src={profilePicture}
                alt="Student Profile"
                className="big-avatar-image"
              />

            ) : (

              firstLetter

            )}

          </div>

        </section>


        {/* =========================
            STATS
        ========================= */}

        <section className="student-stats">

          <div className="student-stat">

            <span>
              📅
            </span>

            <small>
              Attendance
            </small>

            <strong>
              {attendance}%
            </strong>

          </div>


          <div className="student-stat">

            <span>
              📝
            </span>

            <small>
              Legacy Assignment Score
            </small>

            <strong>
              {assignment}%
            </strong>

          </div>


          <div className="student-stat">

            <span>
              🎯
            </span>

            <small>
              Legacy Final Score
            </small>

            <strong>
              {finalScore}%
            </strong>

          </div>


          <div className="student-stat highlight">

            <span>
              📊
            </span>

            <small>
              Legacy Performance Snapshot
            </small>

            <strong>
              {overallPerformance}%
            </strong>

          </div>

        </section>


        {/* =========================
            PERFORMANCE
        ========================= */}

        <section className="student-performance">

          <div className="performance-header">

            <div>

              <h2>
                My Performance
              </h2>

              <p>
                Detailed overview of your
                academic progress.
              </p>

            </div>

            <span className="status-badge">
              {getStatus()}
            </span>

          </div>


          {/* ATTENDANCE */}

          <div className="progress-item">

            <div className="progress-title">

              <span>
                📅 Attendance
              </span>

              <strong>
                {attendance}%
              </strong>

            </div>

            <div className="progress-bar">

              <div
                className="progress-fill"
                style={{
                  width: `${attendance}%`,
                }}
              />

            </div>

          </div>


          {/* ASSIGNMENT */}

          <div className="progress-item">

            <div className="progress-title">

              <span>
                📝 Legacy Assignment Score
              </span>

              <strong>
                {assignment}%
              </strong>

            </div>

            <div className="progress-bar">

              <div
                className="progress-fill"
                style={{
                  width: `${assignment}%`,
                }}
              />

            </div>

          </div>


          {/* FINAL */}

          <div className="progress-item">

            <div className="progress-title">

              <span>
                🎯 Legacy Final Score
              </span>

              <strong>
                {finalScore}%
              </strong>

            </div>

            <div className="progress-bar">

              <div
                className="progress-fill"
                style={{
                  width: `${finalScore}%`,
                }}
              />

            </div>

          </div>


          {/* OVERALL */}

          <div className="overall-box">

            <div>

              <small>
                Legacy Performance Snapshot
              </small>

              <h3>
                {overallPerformance}%
              </h3>

            </div>


            <div className="overall-circle">
              {overallPerformance}%
            </div>

          </div>

        </section>


        {/* =========================
            CHART
        ========================= */}

        <section className="chart-card">

          <div className="chart-header">

            <div>

              <h2>
                Performance Overview
              </h2>

              <p>
                Legacy profile snapshot scores
              </p>

            </div>

            <span className="chart-label">
              2026
            </span>

          </div>


          <div className="bar-chart">

            <div className="chart-column">

              <div className="chart-value">
                {attendance}%
              </div>

              <div
                className="chart-bar"
                style={{
                  height:
                    `${attendance * 2}px`,
                }}
              />

              <span>
                Attendance
              </span>

            </div>


            <div className="chart-column">

              <div className="chart-value">
                {assignment}%
              </div>

              <div
                className="chart-bar"
                style={{
                  height:
                    `${assignment * 2}px`,
                }}
              />

              <span>
                Assignment
              </span>

            </div>


            <div className="chart-column">

              <div className="chart-value">
                {finalScore}%
              </div>

              <div
                className="chart-bar"
                style={{
                  height:
                    `${finalScore * 2}px`,
                }}
              />

              <span>
                Final Score
              </span>

            </div>


            <div className="chart-column">

              <div className="chart-value">
                {overallPerformance}%
              </div>

              <div
                className="chart-bar"
                style={{
                  height:
                    `${
                      Number(
                        overallPerformance
                      ) * 2
                    }px`,
                }}
              />

              <span>
                Overall
              </span>

            </div>

          </div>

        </section>


        {/* =========================
            DETAILS
        ========================= */}

        <button
          className="details-button"
          onClick={() =>
            setShowDetails(
              !showDetails
            )
          }
        >
          {showDetails
            ? "Hide Performance Details"
            : "View Performance Details"}
        </button>


        {showDetails && (

          <section className="details-card">

            <h2>
              Legacy Snapshot Calculation
            </h2>

            <p>
              This prototype formula is shown for legacy profile data only; it is not the published course grade.
            </p>


            <div className="calculation">

              <div>

                <span>
                  Attendance
                </span>

                <strong>
                  20%
                </strong>

              </div>


              <div>

                <span>
                  Assignment
                </span>

                <strong>
                  30%
                </strong>

              </div>


              <div>

                <span>
                  Final Score
                </span>

                <strong>
                  50%
                </strong>

              </div>

            </div>


            <div className="formula">

              ({attendance} × 20%) + (
              {assignment} × 30%) + (
              {finalScore} × 50%)

              <strong>
                = {overallPerformance}%
              </strong>

            </div>

          </section>

        )}

        <StudentAttendance onSummary={setOfficialAttendance} />
        <StudentResults />

      </main>


      {/* =================================================
          PROFILE POPUP
      ================================================= */}

      {showProfile && (

        <div
          className="profile-modal-overlay"
          onClick={(e) => {

            if (
              e.target ===
              e.currentTarget
            ) {
              setShowProfile(false);
            }

          }}
        >

          <div className="profile-modal">

            {/* CLOSE */}

            <button
              type="button"
              className="profile-close-button"
              onClick={() =>
                setShowProfile(false)
              }
            >
              ×
            </button>


            {/* PROFILE PHOTO */}

            <div className="profile-photo-wrapper">

              <div className="profile-photo">

                {profilePicture ? (

                  <img
                    src={profilePicture}
                    alt="Student Profile"
                  />

                ) : (

                  firstLetter

                )}

              </div>

            </div>


            {/* UPLOAD */}

            <label className="upload-picture-button">

              {pictureSaving ? "Saving profile photo…" : "📷 Choose profile picture"}

              <input
                type="file"
                accept="image/*"
                onChange={handleProfilePicture}
                disabled={pictureSaving}
                hidden
              />

            </label>
            {pictureSaving && <p className="profile-feedback" role="status">Uploading your photo to your account…</p>}
            {profilePicture && <button
              type="button"
              className="secondary-button remove-profile-picture"
              onClick={handleRemoveProfilePicture}
              disabled={pictureSaving}
            >{pictureSaving ? "Saving photo…" : "Remove profile picture"}</button>}
            {pictureError && <p className="profile-feedback error" role="alert">{pictureError}</p>}
            <small className="profile-picture-note">Profile photos are saved to your account and visible after you sign in on another device. Existing browser-only photos stay on this device until replaced or removed. Maximum upload 5 MB and 25 megapixels before resizing.</small>


            {/* NAME */}

            <div className="profile-detail">

              <small>
                Full Name
              </small>

              <strong>
                {student.name}
              </strong>

            </div>


            {/* EMAIL */}

            <div className="profile-detail">

              <small>
                Email
              </small>

              <strong>
                {student.email}
              </strong>

            </div>


            {/* COURSE */}

            <div className="profile-detail">

              <small>
                Course
              </small>

              <strong>
                {student.course}
              </strong>

            </div>


            {/* BATCH */}

            <div className="profile-detail">

              <small>
                Batch
              </small>

              <strong>
                {student.batch}
              </strong>

            </div>

            <p className="profile-policy-note">Your official roster name, email, course, and batch are managed by your school. You can update your preferred display name below.</p>

            {profileNotice && <p className="profile-feedback success" role="status">{profileNotice}</p>}
            {profileError && <p className="profile-feedback error" role="alert">{profileError}</p>}

            <form className="profile-settings-form" onSubmit={handleProfileSave}>
              <label>Preferred display name<input type="text" maxLength="80" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={student.name} /></label>
              <button type="submit" className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save display name"}</button>
            </form>

            <form className="profile-settings-form" onSubmit={handlePasswordChange}>
              <h3>Change password</h3>
              <label>Current password<input required type="password" maxLength="128" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>New password<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Confirm new password<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} /></label>
              <button type="submit" className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving…" : "Change password"}</button>
              <small>Changing your password signs out other active sessions.</small>
            </form>


            <button
              type="button"
              className="profile-done-button"
              onClick={() =>
                setShowProfile(false)
              }
            >
              Done
            </button>

          </div>

        </div>

      )}

    </div>
  );
}

export default StudentDashboard;
